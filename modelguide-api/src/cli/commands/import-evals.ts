/**
 * mg import-evals — Import eval suites (evaluators + test cases) from YAML or JSON.
 *
 * Supports two formats:
 *  - YAML (evals.yaml): Separate evaluators + test_cases sections
 *  - JSON (eval-scenarios.json): Flat scenarios with inline criteria
 *
 * Groups test cases by sop_slug → one eval_suite per (agent, SOP) pair.
 * Evaluators become llm_judge eval_configs shared at the suite level.
 * Idempotent: re-running skips existing suites, configs, evaluators, and test cases.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { forOrg } from "@db/rls";
import {
  evalConfigs,
  evalSuiteEvaluators,
  evalSuiteTestCases,
  evalSuites,
} from "@db/schema";
import { createEvalConfig } from "@features/eval-configs/eval-configs.service";
import {
  createEvaluator,
  createSuite,
  createTestCase,
} from "@features/evals/eval-suites.service";
import type { Command } from "commander";
import { and, desc, eq } from "drizzle-orm";
import { getErrorMessage } from "../lib/errors";
import type { IdRegistry } from "../lib/id-registry";
import { log } from "../lib/logger";
import { lookupAgentIds } from "../lib/resolve-agents";
import { resolveOrgId } from "../lib/resolve-org";
import { lookupSopIds } from "../lib/resolve-sops";
import { loadYaml } from "../lib/yaml-loader";
import {
  type NormalizedEvalsInput,
  type NormalizedTestCase,
  evalScenariosJsonSchema,
  evalsYamlFileSchema,
  normalizeJson,
  normalizeYaml,
} from "../schemas/evals.schema";

// ============================================================================
// Result type
// ============================================================================

export interface ImportEvalsResult {
  suitesCreated: number;
  suitesExisting: number;
  testCasesCreated: number;
  testCasesSkipped: number;
  evalConfigsCreated: number;
}

// ============================================================================
// File loading & format detection
// ============================================================================

function resolveEvalsInput(
  fileOrDir: string,
  agentSlug?: string,
): NormalizedEvalsInput {
  const absPath = path.resolve(fileOrDir);

  let filePath: string;
  let isJson: boolean;

  if (existsSync(absPath) && statSync(absPath).isDirectory()) {
    // Directory — look for files
    const yamlPath = path.join(absPath, "evals.yaml");
    const ymlPath = path.join(absPath, "evals.yml");
    const jsonPath = path.join(absPath, "eval-scenarios.json");

    if (existsSync(yamlPath)) {
      filePath = yamlPath;
      isJson = false;
    } else if (existsSync(ymlPath)) {
      filePath = ymlPath;
      isJson = false;
    } else if (existsSync(jsonPath)) {
      filePath = jsonPath;
      isJson = true;
    } else {
      throw new Error(
        `No evals.yaml or eval-scenarios.json found in ${absPath}`,
      );
    }
  } else if (existsSync(absPath)) {
    filePath = absPath;
    isJson = absPath.endsWith(".json");
  } else {
    throw new Error(`File not found: ${absPath}`);
  }

  if (isJson) {
    if (!agentSlug) {
      throw new Error(
        "--agent is required when importing from JSON (no agentSlug in file)",
      );
    }
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = evalScenariosJsonSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Validation failed for ${filePath}:\n${issues}`);
    }
    return normalizeJson(result.data, agentSlug);
  }

  // YAML
  const parsed = loadYaml(filePath, evalsYamlFileSchema);
  const normalized = normalizeYaml(parsed);

  // If --agent was also provided, verify it matches
  if (agentSlug && agentSlug !== normalized.agentSlug) {
    throw new Error(
      `--agent "${agentSlug}" conflicts with agentSlug "${normalized.agentSlug}" in ${filePath}`,
    );
  }

  return normalized;
}

// ============================================================================
// Find-or-create helpers (direct DB queries for dedup)
// ============================================================================

/** Find an existing eval suite for (agent, SOP) pair. */
async function findExistingSuite(
  orgId: string,
  agentId: string,
  sopId: string,
): Promise<string | null> {
  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(and(eq(evalSuites.agentId, agentId), eq(evalSuites.sopId, sopId)))
      .orderBy(desc(evalSuites.createdAt))
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

/** Find an existing eval config by name and evaluator type. */
async function findExistingEvalConfig(
  orgId: string,
  name: string,
): Promise<string | null> {
  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: evalConfigs.id })
      .from(evalConfigs)
      .where(
        and(
          eq(evalConfigs.name, name),
          eq(evalConfigs.evaluatorType, "llm_judge"),
        ),
      )
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

/** Find existing evaluator on a suite by eval config ID. */
async function findExistingEvaluator(
  orgId: string,
  suiteId: string,
  evalConfigId: string,
): Promise<boolean> {
  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: evalSuiteEvaluators.id })
      .from(evalSuiteEvaluators)
      .where(
        and(
          eq(evalSuiteEvaluators.suiteId, suiteId),
          eq(evalSuiteEvaluators.evalConfigId, evalConfigId),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/** Load existing test case external IDs for a suite. */
async function loadExistingTestCaseIds(
  orgId: string,
  suiteId: string,
): Promise<Set<string>> {
  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ input: evalSuiteTestCases.input })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId)),
  );

  const ids = new Set<string>();
  for (const row of rows) {
    const input = row.input as Record<string, unknown> | null;
    if (input?.externalId && typeof input.externalId === "string") {
      ids.add(input.externalId);
    }
  }
  return ids;
}

// ============================================================================
// Main handler
// ============================================================================

export async function handleImportEvals(
  orgId: string,
  normalized: NormalizedEvalsInput,
  options?: { registry?: IdRegistry },
): Promise<ImportEvalsResult> {
  const result: ImportEvalsResult = {
    suitesCreated: 0,
    suitesExisting: 0,
    testCasesCreated: 0,
    testCasesSkipped: 0,
    evalConfigsCreated: 0,
  };

  // 1. Resolve agent
  const agentMap = await lookupAgentIds(
    orgId,
    [normalized.agentSlug],
    options?.registry,
  );
  const agentId = agentMap.get(normalized.agentSlug);
  if (!agentId) {
    throw new Error(
      `Agent "${normalized.agentSlug}" not found in organization`,
    );
  }

  // 2. Resolve SOPs
  const sopSlugs = [...new Set(normalized.testCases.map((tc) => tc.sopSlug))];
  const sopMap = await lookupSopIds(orgId, sopSlugs, options?.registry);

  // 3. Create eval configs for all evaluators
  const evalConfigIdMap = new Map<string, string>(); // evaluator name → config ID
  for (const evaluator of normalized.evaluators) {
    const configName = `import:${evaluator.name}`;

    const existingId = await findExistingEvalConfig(orgId, configName);
    if (existingId) {
      evalConfigIdMap.set(evaluator.name, existingId);
    } else {
      const config = await createEvalConfig(orgId, {
        name: configName,
        description: `Imported evaluator: ${evaluator.criterion.slice(0, 200)}`,
        evaluatorType: "llm_judge",
        config: { criterion: evaluator.criterion },
        tags: evaluator.tags,
      });
      evalConfigIdMap.set(evaluator.name, config.id);
      result.evalConfigsCreated++;

      if (options?.registry) {
        options.registry.set("evalConfig", evaluator.name, config.id);
      }
    }
  }

  // 4. Build evaluator name → criterion lookup
  const evaluatorCriterionMap = new Map<string, string>();
  for (const evaluator of normalized.evaluators) {
    evaluatorCriterionMap.set(evaluator.name, evaluator.criterion);
  }

  // 5. Group test cases by SOP slug
  const groupedBySop = new Map<string, NormalizedTestCase[]>();
  for (const tc of normalized.testCases) {
    const group = groupedBySop.get(tc.sopSlug) ?? [];
    group.push(tc);
    groupedBySop.set(tc.sopSlug, group);
  }

  // 6. Process each SOP group
  for (const [sopSlug, testCases] of groupedBySop) {
    const sop = sopMap.get(sopSlug);
    if (!sop) {
      log.warn(
        `SOP "${sopSlug}" not found, skipping ${testCases.length} test case(s)`,
      );
      result.testCasesSkipped += testCases.length;
      continue;
    }

    // 6a. Find or create suite
    let suiteId = await findExistingSuite(orgId, agentId, sop.id);

    if (suiteId) {
      result.suitesExisting++;
      log.info(`Using existing suite for ${sopSlug}`);
    } else {
      const suite = await createSuite(orgId, {
        agentId,
        sopId: sop.id,
        name: `Eval: ${sop.name}`,
      });
      suiteId = suite.id;
      result.suitesCreated++;
      log.success(`Created suite: Eval: ${sop.name}`);

      if (options?.registry) {
        options.registry.set("evalSuite", sopSlug, suiteId);
      }
    }

    // 6b. Collect evaluator names referenced by test cases in this group
    const referencedEvaluators = new Set<string>();
    for (const tc of testCases) {
      for (const name of tc.evaluatorNames) {
        referencedEvaluators.add(name);
      }
    }

    // 6c. Add suite-level evaluators (union of all referenced)
    for (const evalName of referencedEvaluators) {
      const configId = evalConfigIdMap.get(evalName);
      if (!configId) continue;

      const exists = await findExistingEvaluator(orgId, suiteId, configId);
      if (!exists) {
        await createEvaluator(orgId, suiteId, {
          evalConfigId: configId,
          name: evalName,
          required: true,
        });
      }
    }

    // 6d. Load existing test case IDs for dedup
    const existingIds = await loadExistingTestCaseIds(orgId, suiteId);

    // 6e. Create test cases
    for (const tc of testCases) {
      if (existingIds.has(tc.id)) {
        result.testCasesSkipped++;
        continue;
      }

      // Build description from metadata
      const descParts: string[] = [];
      if (tc.scenarioKey) descParts.push(`scenario: ${tc.scenarioKey}`);
      if (tc.description) descParts.push(tc.description);
      if (tc.tags.length > 0) descParts.push(`tags: ${tc.tags.join(", ")}`);
      if (tc.guardrailsTested.length > 0)
        descParts.push(`guardrails: ${tc.guardrailsTested.join(", ")}`);

      // Build expectedBehavior from the test case's specific evaluators
      const expectedBehavior = tc.evaluatorNames
        .map((name, i) => {
          const criterion = evaluatorCriterionMap.get(name) ?? name;
          return `${i + 1}. ${criterion}`;
        })
        .join("\n");

      await createTestCase(orgId, suiteId, {
        name: tc.id,
        description: descParts.length > 0 ? descParts.join(" | ") : undefined,
        source: "manual",
        input: {
          externalId: tc.id,
          message: tc.input.message,
          conversationHistory: tc.input.conversationHistory,
          context: tc.input.context,
        },
        expectedBehavior,
      });

      result.testCasesCreated++;
    }
  }

  return result;
}

// ============================================================================
// Commander registration
// ============================================================================

export function registerImportEvalsCommand(program: Command): void {
  program
    .command("import-evals")
    .description(
      "Import eval suites (evaluators + test cases) from YAML or JSON",
    )
    .requiredOption("--org <slug>", "Organization slug")
    .option(
      "--agent <slug>",
      "Agent slug (required for JSON, optional for YAML)",
    )
    .argument("<file-or-dir>", "YAML/JSON file or directory containing evals")
    .action(
      async (fileOrDir: string, opts: { org: string; agent?: string }) => {
        try {
          const orgId = await resolveOrgId(opts.org);
          const normalized = resolveEvalsInput(fileOrDir, opts.agent);

          const result = await handleImportEvals(orgId, normalized);

          log.success(
            [
              `Suites: ${result.suitesCreated} created, ${result.suitesExisting} existing`,
              `Test cases: ${result.testCasesCreated} created, ${result.testCasesSkipped} skipped`,
              `Eval configs: ${result.evalConfigsCreated} created`,
            ].join("\n"),
          );
        } catch (err) {
          log.error(`Failed: ${getErrorMessage(err)}`);
          process.exit(1);
        }
      },
    );
}
