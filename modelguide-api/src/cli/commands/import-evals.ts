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
  evalTestCaseEvaluators,
  sopSteps,
} from "@db/schema";
import { createEvalConfig } from "@features/eval-configs/eval-configs.service";
import {
  createSuite,
  createTestCase,
} from "@features/evals/eval-suites.service";
import type { Command } from "commander";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
  testCasesReplaced: number;
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

/** Load existing test cases for a suite: externalId → DB row id. */
async function loadExistingTestCases(
  orgId: string,
  suiteId: string,
): Promise<Map<string, string>> {
  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: evalSuiteTestCases.id, input: evalSuiteTestCases.input })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId)),
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    const input = row.input as Record<string, unknown> | null;
    if (input?.externalId && typeof input.externalId === "string") {
      map.set(input.externalId, row.id);
    }
  }
  return map;
}

/** Replace (update) an existing test case by its DB id. */
async function replaceTestCase(
  orgId: string,
  testCaseId: string,
  data: {
    description?: string;
    input: Record<string, unknown>;
    mockToolResponses?: Record<string, unknown>;
  },
): Promise<void> {
  await forOrg(orgId, (tx) =>
    tx
      .update(evalSuiteTestCases)
      .set({
        description: data.description ?? null,
        input: data.input,
        mockToolResponses: data.mockToolResponses ?? {},
      })
      .where(eq(evalSuiteTestCases.id, testCaseId)),
  );
}

// ============================================================================
// Main handler
// ============================================================================

export async function handleImportEvals(
  orgId: string,
  normalized: NormalizedEvalsInput,
  options?: { registry?: IdRegistry; replace?: boolean },
): Promise<ImportEvalsResult> {
  const result: ImportEvalsResult = {
    suitesCreated: 0,
    suitesExisting: 0,
    testCasesCreated: 0,
    testCasesSkipped: 0,
    testCasesReplaced: 0,
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

  // 4. Group test cases by SOP slug
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

    // 6b. Load existing test cases for dedup / replace
    const existingTestCases = await loadExistingTestCases(orgId, suiteId);

    // 6c. Reconcile suite-level evaluators against `common_evaluators` yaml.
    // Suite = "evaluators every case runs". Cases' own evaluator lists become
    // per-case `add` overrides (excluding those already at suite level).
    //
    // Reconcile (not just attach): if a name was removed from common_evaluators,
    // detach it. Only touch rows with source="auto" — dashboard-added manual
    // evaluators are preserved.
    const suiteEvaluatorNames = normalized.commonEvaluatorNames;
    await reconcileSuiteEvaluators(
      orgId,
      suiteId,
      suiteEvaluatorNames,
      evalConfigIdMap,
    );

    // 6d. Auto-derive `tool_called` evaluators from the SOP's tool-bound steps.
    // YAML can't express these directly — the SOP itself declares which step
    // binds which connector tool, so every run asserts "the agent actually
    // invoked the tool this step requires". Matches the initSuiteFromSop path.
    await reconcileAutoToolCalledEvaluators(orgId, suiteId, sop.id, sopSlug);

    // 6e. Create or replace test cases with per-case evaluator overrides
    const suiteEvaluatorSet = new Set(suiteEvaluatorNames);
    for (const tc of testCases) {
      // Build description from metadata
      const descParts: string[] = [];
      if (tc.scenarioKey) descParts.push(`scenario: ${tc.scenarioKey}`);
      if (tc.description) descParts.push(tc.description);
      if (tc.tags.length > 0) descParts.push(`tags: ${tc.tags.join(", ")}`);
      if (tc.guardrailsTested.length > 0)
        descParts.push(`guardrails: ${tc.guardrailsTested.join(", ")}`);

      const inputPayload = {
        externalId: tc.id,
        message: tc.input.message,
        conversationHistory: tc.input.conversationHistory,
        context: tc.input.context,
        persona: tc.input.persona,
      };

      const existingDbId = existingTestCases.get(tc.id);
      if (existingDbId) {
        if (options?.replace) {
          await replaceTestCase(orgId, existingDbId, {
            description:
              descParts.length > 0 ? descParts.join(" | ") : undefined,
            input: inputPayload,
            mockToolResponses: tc.mockToolResponses,
          });
          result.testCasesReplaced++;
        } else {
          result.testCasesSkipped++;
        }
        continue;
      }

      const testCase = await createTestCase(orgId, suiteId, {
        name: tc.id,
        description: descParts.length > 0 ? descParts.join(" | ") : undefined,
        source: "manual",
        input: inputPayload,
        mockToolResponses: tc.mockToolResponses,
      });

      // Per-case `add` overrides only for evaluators NOT promoted to suite level.
      const caseSpecificNames = tc.evaluatorNames.filter(
        (name) => !suiteEvaluatorSet.has(name),
      );
      const overrideValues = caseSpecificNames
        .map((name, i) => {
          const configId = evalConfigIdMap.get(name);
          if (!configId) return null;
          return {
            organizationId: orgId,
            testCaseId: testCase.id,
            evalConfigId: configId,
            overrideType: "add" as const,
            name,
            order: i,
            required: true,
            source: "auto" as const,
          };
        })
        .filter((v) => v !== null);

      if (overrideValues.length > 0) {
        await forOrg(orgId, (tx) =>
          tx.insert(evalTestCaseEvaluators).values(overrideValues),
        );
      }

      result.testCasesCreated++;
    }
  }

  return result;
}

/**
 * Reconcile suite-level llm_judge evaluators against the yaml's
 * `common_evaluators` list.
 *
 * Scope: rows with source="auto" AND sopStepId IS NULL. Tool-called evaluators
 * (source="auto", sopStepId IS NOT NULL) are reconciled separately by
 * `reconcileAutoToolCalledEvaluators` — leaving them alone here prevents one
 * reconcile from clobbering the other.
 *
 * Manual (dashboard-added) evaluators are always preserved.
 */
async function reconcileSuiteEvaluators(
  orgId: string,
  suiteId: string,
  targetNames: string[],
  evalConfigIdMap: Map<string, string>,
): Promise<void> {
  await forOrg(orgId, async (tx) => {
    const existing = await tx
      .select({
        id: evalSuiteEvaluators.id,
        name: evalSuiteEvaluators.name,
        source: evalSuiteEvaluators.source,
        sopStepId: evalSuiteEvaluators.sopStepId,
      })
      .from(evalSuiteEvaluators)
      .where(eq(evalSuiteEvaluators.suiteId, suiteId));

    // Only manage auto rows without an sopStepId — tool_called evaluators
    // (which are scoped to a step) are outside this reconcile's remit.
    const existingAuto = new Map(
      existing
        .filter((r) => r.source === "auto" && r.sopStepId === null)
        .map((r) => [r.name, r.id] as const),
    );
    const target = new Set(targetNames);

    // Remove stale auto rows no longer in target
    const toRemove = [...existingAuto.entries()]
      .filter(([name]) => !target.has(name))
      .map(([, id]) => id);
    if (toRemove.length > 0) {
      await tx
        .delete(evalSuiteEvaluators)
        .where(inArray(evalSuiteEvaluators.id, toRemove));
    }

    // Insert targets; unique constraint on (suiteId, name) prevents duplicates from
    // concurrent imports and skips names already present as manual rows.
    const toInsert = targetNames
      .map((name, order) => {
        const configId = evalConfigIdMap.get(name);
        if (!configId) {
          log.warn(`common_evaluators: "${name}" has no eval config — skipped`);
          return null;
        }
        return {
          organizationId: orgId,
          suiteId,
          evalConfigId: configId,
          name,
          order,
          required: true,
          source: "auto" as const,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (toInsert.length > 0) {
      // Upsert: on conflict, re-wire evalConfigId. This self-heals rows left
      // pointing at a config in a different org (e.g. after a cross-org
      // import bug moves SOPs between orgs but leaves eval_configs behind —
      // RLS then hides the config and the suite_evaluator reads as orphaned).
      await tx
        .insert(evalSuiteEvaluators)
        .values(toInsert)
        .onConflictDoUpdate({
          target: [evalSuiteEvaluators.suiteId, evalSuiteEvaluators.name],
          set: {
            evalConfigId: sql`EXCLUDED.eval_config_id`,
            order: sql`EXCLUDED.order`,
            required: sql`EXCLUDED.required`,
          },
        });
    }
  });
}

/**
 * Derive suite-level `tool_called` evaluators from the SOP's steps.
 *
 * Every step whose `connectorToolId` is set becomes a required suite evaluator
 * that asserts the agent actually called that tool during the simulation.
 * YAML can't declare these directly — they're derived from the SOP binding,
 * mirroring what `initSuiteFromSop` does for dashboard-initialized suites.
 *
 * Scope: rows with source="auto" AND sopStepId IS NOT NULL. Reconciled per
 * run: insert missing steps, delete evaluators whose step no longer binds a
 * tool (or was removed from the SOP).
 */
async function reconcileAutoToolCalledEvaluators(
  orgId: string,
  suiteId: string,
  sopId: string,
  sopSlug: string,
): Promise<{ added: number; removed: number }> {
  return forOrg(orgId, async (tx) => {
    // Auto-generate tool_called checks only for REQUIRED steps — non-required
    // steps are optional flows (e.g. upsells, proactive messaging) and
    // shouldn't count as hard failures. This keeps each suite to ~3-5 auto
    // evaluators instead of exploding with every step.
    const steps = await tx
      .select({
        stepId: sopSteps.stepId,
        order: sopSteps.order,
        instruction: sopSteps.instruction,
        required: sopSteps.required,
        connectorToolId: sopSteps.connectorToolId,
      })
      .from(sopSteps)
      .where(
        and(
          eq(sopSteps.sopId, sopId),
          isNotNull(sopSteps.connectorToolId),
          eq(sopSteps.required, true),
        ),
      )
      .orderBy(asc(sopSteps.order));

    const existing = await tx
      .select({
        id: evalSuiteEvaluators.id,
        sopStepId: evalSuiteEvaluators.sopStepId,
        evalConfigId: evalSuiteEvaluators.evalConfigId,
      })
      .from(evalSuiteEvaluators)
      .where(
        and(
          eq(evalSuiteEvaluators.suiteId, suiteId),
          eq(evalSuiteEvaluators.source, "auto"),
          isNotNull(evalSuiteEvaluators.sopStepId),
        ),
      );
    const existingByStep = new Map(
      existing
        .filter((r) => r.sopStepId !== null)
        .map(
          (r) =>
            [
              r.sopStepId as string,
              { id: r.id, evalConfigId: r.evalConfigId },
            ] as const,
        ),
    );

    const targetStepIds = new Set(steps.map((s) => s.stepId));

    const toRemove = [...existingByStep.entries()]
      .filter(([stepId]) => !targetStepIds.has(stepId))
      .map(([, v]) => v.id);
    if (toRemove.length > 0) {
      await tx
        .delete(evalSuiteEvaluators)
        .where(inArray(evalSuiteEvaluators.id, toRemove));
    }

    let added = 0;
    for (const step of steps) {
      if (!step.connectorToolId) continue;

      const configName = `auto:tool_called:${sopSlug}:${step.stepId}`;
      const toolConfig = { connectorToolId: step.connectorToolId };

      const [existingConfig] = await tx
        .select({ id: evalConfigs.id })
        .from(evalConfigs)
        .where(
          and(
            eq(evalConfigs.name, configName),
            eq(evalConfigs.evaluatorType, "tool_called"),
          ),
        );
      let configId: string;
      if (existingConfig) {
        await tx
          .update(evalConfigs)
          .set({ config: toolConfig })
          .where(eq(evalConfigs.id, existingConfig.id));
        configId = existingConfig.id;
      } else {
        const [created] = await tx
          .insert(evalConfigs)
          .values({
            organizationId: orgId,
            name: configName,
            description: `Auto-generated from SOP step: ${step.stepId}`,
            evaluatorType: "tool_called",
            config: toolConfig,
          })
          .returning({ id: evalConfigs.id });
        configId = created.id;
      }

      const label = step.instruction
        ? step.instruction.slice(0, 80)
        : `step ${step.order}`;

      const existingForStep = existingByStep.get(step.stepId);
      if (existingForStep) {
        // Row exists — re-wire evalConfigId in case it points to a stale
        // (cross-org or deleted) config, and refresh order/required.
        if (existingForStep.evalConfigId !== configId) {
          await tx
            .update(evalSuiteEvaluators)
            .set({
              evalConfigId: configId,
              order: step.order,
              required: step.required,
            })
            .where(eq(evalSuiteEvaluators.id, existingForStep.id));
        }
        continue;
      }

      await tx.insert(evalSuiteEvaluators).values({
        organizationId: orgId,
        suiteId,
        evalConfigId: configId,
        name: `${label} (tool_called)`,
        sopStepId: step.stepId,
        source: "auto",
        order: step.order,
        required: step.required,
      });
      added++;
    }

    return { added, removed: toRemove.length };
  });
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
    .option(
      "--replace",
      "Replace existing test cases instead of skipping them",
      false,
    )
    .argument("<file-or-dir>", "YAML/JSON file or directory containing evals")
    .action(
      async (
        fileOrDir: string,
        opts: { org: string; agent?: string; replace: boolean },
      ) => {
        try {
          const orgId = await resolveOrgId(opts.org);
          const normalized = resolveEvalsInput(fileOrDir, opts.agent);

          const result = await handleImportEvals(orgId, normalized, {
            replace: opts.replace,
          });

          const tcParts = [
            `${result.testCasesCreated} created`,
            `${result.testCasesSkipped} skipped`,
          ];
          if (result.testCasesReplaced > 0) {
            tcParts.push(`${result.testCasesReplaced} replaced`);
          }

          log.success(
            [
              `Suites: ${result.suitesCreated} created, ${result.suitesExisting} existing`,
              `Test cases: ${tcParts.join(", ")}`,
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
