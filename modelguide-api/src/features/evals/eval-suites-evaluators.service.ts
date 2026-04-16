/**
 * Evaluator management — suite-level CRUD, per-case overrides, and
 * evaluator merge logic for runtime resolution.
 *
 * Extracted from eval-suites.service.ts to keep file sizes manageable.
 */

import { type Transaction, forOrg } from "@db/rls";
import {
  type EvalSuiteEvaluator,
  type EvalTestCaseEvaluator,
  connectorTools,
  connectors,
  evalConfigs,
  evalSuiteEvaluators,
  evalSuiteTestCases,
  evalSuites,
  evalTestCaseEvaluators,
} from "@db/schema";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type {
  CreateEvaluatorInput,
  CreateTestCaseEvaluatorInput,
} from "./eval-suites.types";
import { extractConnectorToolIds } from "./evals.compile";
import type { ResolvedAssertion } from "./evals.types";

const log = getLogger();

/** Truncate string to N chars for score name. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

// ============================================================================
// Shared helpers
// ============================================================================

/** Load evaluators for a suite, joined with eval config tags, type, and live name. */
export async function loadSuiteEvaluators(
  tx: Transaction,
  suiteId: string,
): Promise<
  (EvalSuiteEvaluator & {
    tags: string[];
    evaluatorType: string | null;
    config: Record<string, unknown> | null;
    configName: string | null;
  })[]
> {
  const rows = await tx
    .select({
      evaluator: evalSuiteEvaluators,
      tags: evalConfigs.tags,
      evaluatorType: evalConfigs.evaluatorType,
      config: evalConfigs.config,
      configName: evalConfigs.name,
    })
    .from(evalSuiteEvaluators)
    .leftJoin(evalConfigs, eq(evalSuiteEvaluators.evalConfigId, evalConfigs.id))
    .where(eq(evalSuiteEvaluators.suiteId, suiteId))
    .orderBy(asc(evalSuiteEvaluators.order));

  return rows.map((r) => ({
    ...r.evaluator,
    tags: r.tags ?? [],
    evaluatorType: r.evaluatorType ?? null,
    config: (r.config as Record<string, unknown> | null) ?? null,
    configName: r.configName ?? null,
  }));
}

// ============================================================================
// Resolve evaluators for execution
// ============================================================================

/**
 * Resolve evaluators for a suite into ready-to-execute form.
 * Loads eval_configs and resolves connector tool names.
 *
 * When `testCaseId` is provided, applies per-case overrides:
 * effective = suite_evaluators - case_excludes + case_adds (AC 8)
 */
export async function resolveAssertions(
  tx: Transaction,
  suiteId: string,
  testCaseId?: string,
): Promise<ResolvedAssertion[]> {
  // Load assertions for this suite
  let assertions = await tx
    .select()
    .from(evalSuiteEvaluators)
    .where(eq(evalSuiteEvaluators.suiteId, suiteId))
    .orderBy(asc(evalSuiteEvaluators.order));

  // Per-case override merge (AC 8)
  let caseAddAssertions: Array<{
    evalConfigId: string;
    name: string;
    order: number;
    required: boolean;
  }> = [];

  if (testCaseId) {
    const overrides = await tx
      .select()
      .from(evalTestCaseEvaluators)
      .where(eq(evalTestCaseEvaluators.testCaseId, testCaseId))
      .orderBy(asc(evalTestCaseEvaluators.order));

    if (overrides.length > 0) {
      // Apply excludes
      const excludedConfigIds = new Set(
        overrides
          .filter((o) => o.overrideType === "exclude")
          .map((o) => o.evalConfigId),
      );

      assertions = assertions.filter(
        (a) => !excludedConfigIds.has(a.evalConfigId),
      );

      // Collect adds (will be appended after resolving configs)
      caseAddAssertions = overrides
        .filter((o) => o.overrideType === "add")
        .map((o) => ({
          evalConfigId: o.evalConfigId,
          name: o.name,
          order: o.order,
          required: o.required,
        }));
    }
  }

  if (assertions.length === 0 && caseAddAssertions.length === 0) return [];

  // Batch-load eval configs (include case-add config IDs)
  const allConfigIds = [
    ...assertions.map((a) => a.evalConfigId),
    ...caseAddAssertions.map((a) => a.evalConfigId),
  ];
  const configIds = [...new Set(allConfigIds)];
  const configs =
    configIds.length > 0
      ? await tx
          .select()
          .from(evalConfigs)
          .where(inArray(evalConfigs.id, configIds))
      : [];

  const configMap = new Map(configs.map((c) => [c.id, c]));

  // Collect all connector tool IDs for resolution
  const allToolIds: string[] = [];
  for (const cfg of configs) {
    allToolIds.push(
      ...extractConnectorToolIds(cfg.config as Record<string, unknown>),
    );
  }
  const uniqueToolIds = [...new Set(allToolIds)];

  // Resolve tool names
  const toolNameMap = new Map<string, string>();
  if (uniqueToolIds.length > 0) {
    const toolRows = await tx
      .select({
        toolId: connectorTools.id,
        toolSlug: connectorTools.slug,
        connectorSlug: connectors.slug,
      })
      .from(connectorTools)
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .where(
        and(
          inArray(connectorTools.id, uniqueToolIds),
          isNull(connectorTools.deletedAt),
        ),
      );

    for (const row of toolRows) {
      toolNameMap.set(row.toolId, `${row.connectorSlug}_${row.toolSlug}`);
    }
  }

  // Helper to resolve a single assertion
  function resolveOne(
    evalConfigId: string,
    name: string,
    order: number,
    required: boolean,
  ): ResolvedAssertion {
    const cfg = configMap.get(evalConfigId);
    if (!cfg) {
      log.error(
        { evalConfigId, suiteId },
        "evaluator references missing eval config — data integrity issue",
      );
      return {
        order,
        name: name || `assertion:${order}:missing_config`,
        required,
        evaluator: {
          configId: evalConfigId,
          evaluatorType: "llm_judge" as const,
          config: {
            criterion:
              "ERROR: This evaluator references a deleted eval config. Result should be treated as 'error', not 'pass'.",
          },
        },
        toolNameMap: {},
      };
    }

    const stepToolNameMap: Record<string, string> = {};
    const configToolIds = extractConnectorToolIds(
      cfg.config as Record<string, unknown>,
    );
    for (const toolId of configToolIds) {
      const resolved = toolNameMap.get(toolId);
      stepToolNameMap[toolId] = resolved ?? toolId;
    }

    return {
      order,
      name: cfg.name || name || `${truncate(cfg.evaluatorType, 40)}`,
      required,
      evaluator: {
        configId: cfg.id,
        evaluatorType:
          cfg.evaluatorType as ResolvedAssertion["evaluator"]["evaluatorType"],
        config: cfg.config as Record<string, unknown>,
      },
      toolNameMap: stepToolNameMap,
    };
  }

  // Build resolved assertions (canonical ResolvedAssertion shape)
  const result = assertions.map((a) =>
    resolveOne(a.evalConfigId, a.name, a.order, a.required),
  );

  // Append case-level add overrides after suite evaluators
  const maxSuiteOrder =
    result.length > 0 ? Math.max(...result.map((r) => r.order)) : -1;
  for (let i = 0; i < caseAddAssertions.length; i++) {
    const add = caseAddAssertions[i];
    result.push(
      resolveOne(
        add.evalConfigId,
        add.name,
        maxSuiteOrder + 1 + i,
        add.required,
      ),
    );
  }

  return result;
}

// ============================================================================
// Suite Evaluator CRUD
// ============================================================================

/** Create a manual evaluator for an existing suite. */
export async function createEvaluator(
  orgId: string,
  suiteId: string,
  data: CreateEvaluatorInput,
): Promise<EvalSuiteEvaluator> {
  return forOrg(orgId, async (tx) => {
    // Validate suite exists
    const [suite] = await tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

    // Validate eval config exists
    const [config] = await tx
      .select({ id: evalConfigs.id })
      .from(evalConfigs)
      .where(eq(evalConfigs.id, data.evalConfigId));

    if (!config) {
      throw Errors.notFound(`Eval config "${data.evalConfigId}" not found`);
    }

    // Determine next order
    const existing = await tx
      .select({ order: evalSuiteEvaluators.order })
      .from(evalSuiteEvaluators)
      .where(eq(evalSuiteEvaluators.suiteId, suiteId))
      .orderBy(desc(evalSuiteEvaluators.order))
      .limit(1);

    const nextOrder = existing.length > 0 ? existing[0].order + 1 : 0;

    const [assertion] = await tx
      .insert(evalSuiteEvaluators)
      .values({
        organizationId: orgId,
        suiteId,
        evalConfigId: data.evalConfigId,
        name: data.name,
        source: "manual",
        order: nextOrder,
        required: data.required ?? true,
      })
      .returning();

    return assertion;
  });
}

/**
 * Update the eval config referenced by a suite-level evaluator (AC-26).
 * Only evalConfigId can be changed — order/name/required are untouched.
 */
export async function updateSuiteEvaluator(
  orgId: string,
  suiteId: string,
  evaluatorId: string,
  data: { evalConfigId: string },
): Promise<EvalSuiteEvaluator> {
  return forOrg(orgId, async (tx) => {
    // Validate evaluator belongs to suite
    const [evaluator] = await tx
      .select()
      .from(evalSuiteEvaluators)
      .where(
        and(
          eq(evalSuiteEvaluators.id, evaluatorId),
          eq(evalSuiteEvaluators.suiteId, suiteId),
        ),
      );

    if (!evaluator) {
      throw Errors.notFound("Evaluator not found in this suite");
    }

    // Validate the new eval config exists
    const [config] = await tx
      .select({ id: evalConfigs.id })
      .from(evalConfigs)
      .where(eq(evalConfigs.id, data.evalConfigId));

    if (!config) {
      throw Errors.notFound(`Eval config "${data.evalConfigId}" not found`);
    }

    const [updated] = await tx
      .update(evalSuiteEvaluators)
      .set({ evalConfigId: data.evalConfigId })
      .where(eq(evalSuiteEvaluators.id, evaluatorId))
      .returning();

    return updated;
  });
}

/** Delete a suite-level evaluator and cascade-clean related case-level exclude overrides. */
export async function deleteSuiteEvaluator(
  orgId: string,
  suiteId: string,
  evaluatorId: string,
): Promise<void> {
  return forOrg(orgId, async (tx) => {
    // Validate evaluator exists and belongs to suite
    const [evaluator] = await tx
      .select({
        id: evalSuiteEvaluators.id,
        evalConfigId: evalSuiteEvaluators.evalConfigId,
      })
      .from(evalSuiteEvaluators)
      .where(
        and(
          eq(evalSuiteEvaluators.id, evaluatorId),
          eq(evalSuiteEvaluators.suiteId, suiteId),
        ),
      );

    if (!evaluator) {
      throw Errors.notFound("Evaluator not found in this suite");
    }

    // Cascade cleanup: remove case-level exclude overrides referencing this eval config
    // (AC 7: application-level cascade, not FK)
    const testCaseIds = await tx
      .select({ id: evalSuiteTestCases.id })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId));

    if (testCaseIds.length > 0) {
      const caseIds = testCaseIds.map((tc) => tc.id);
      const excludeOverrides = await tx
        .select({ id: evalTestCaseEvaluators.id })
        .from(evalTestCaseEvaluators)
        .where(
          and(
            inArray(evalTestCaseEvaluators.testCaseId, caseIds),
            eq(evalTestCaseEvaluators.evalConfigId, evaluator.evalConfigId),
            eq(evalTestCaseEvaluators.overrideType, "exclude"),
          ),
        );

      if (excludeOverrides.length > 0) {
        log.warn(
          {
            suiteId,
            evaluatorId,
            evalConfigId: evaluator.evalConfigId,
            cleanedUpCount: excludeOverrides.length,
          },
          "cascade cleanup: removing case-level exclude overrides for deleted suite evaluator",
        );
        await tx.delete(evalTestCaseEvaluators).where(
          inArray(
            evalTestCaseEvaluators.id,
            excludeOverrides.map((o) => o.id),
          ),
        );
      }
    }

    // Delete the suite evaluator
    await tx
      .delete(evalSuiteEvaluators)
      .where(eq(evalSuiteEvaluators.id, evaluatorId));
  });
}

// ============================================================================
// Test Case Evaluator Override CRUD (AC 2-6, 23-24)
// ============================================================================

/** Create a per-case evaluator override. */
export async function createTestCaseEvaluator(
  orgId: string,
  suiteId: string,
  testCaseId: string,
  data: CreateTestCaseEvaluatorInput,
): Promise<EvalTestCaseEvaluator> {
  return forOrg(orgId, async (tx) => {
    // AC 23: Validate test case belongs to this suite
    const [testCase] = await tx
      .select({ id: evalSuiteTestCases.id })
      .from(evalSuiteTestCases)
      .where(
        and(
          eq(evalSuiteTestCases.id, testCaseId),
          eq(evalSuiteTestCases.suiteId, suiteId),
        ),
      );

    if (!testCase) {
      throw Errors.notFound("Test case not found in this suite");
    }

    // AC 24: Validate eval config exists
    const [config] = await tx
      .select({ id: evalConfigs.id, name: evalConfigs.name })
      .from(evalConfigs)
      .where(eq(evalConfigs.id, data.evalConfigId));

    if (!config) {
      throw Errors.notFound(`Eval config "${data.evalConfigId}" not found`);
    }

    // AC 5: Validate exclude targets an existing suite evaluator
    if (data.overrideType === "exclude") {
      const [suiteEval] = await tx
        .select({ id: evalSuiteEvaluators.id })
        .from(evalSuiteEvaluators)
        .where(
          and(
            eq(evalSuiteEvaluators.suiteId, suiteId),
            eq(evalSuiteEvaluators.evalConfigId, data.evalConfigId),
          ),
        );

      if (!suiteEval) {
        throw Errors.validationError(
          "Cannot exclude evaluator not present at suite level",
        );
      }
    }

    // Guard: reject `add` when the config is already inherited at suite level
    if (data.overrideType === "add") {
      const [suiteEval] = await tx
        .select({ id: evalSuiteEvaluators.id })
        .from(evalSuiteEvaluators)
        .where(
          and(
            eq(evalSuiteEvaluators.suiteId, suiteId),
            eq(evalSuiteEvaluators.evalConfigId, data.evalConfigId),
          ),
        );

      if (suiteEval) {
        throw Errors.validationError(
          "Evaluator already inherited from suite — exclude it first or choose a different config",
        );
      }
    }

    // AC 6: Check for duplicate override (same test_case_id + eval_config_id + override_type)
    const [existing] = await tx
      .select({ id: evalTestCaseEvaluators.id })
      .from(evalTestCaseEvaluators)
      .where(
        and(
          eq(evalTestCaseEvaluators.testCaseId, testCaseId),
          eq(evalTestCaseEvaluators.evalConfigId, data.evalConfigId),
          eq(evalTestCaseEvaluators.overrideType, data.overrideType),
        ),
      );

    if (existing) {
      throw Errors.alreadyExists("Test case evaluator override");
    }

    // Determine next order
    const existingOverrides = await tx
      .select({ order: evalTestCaseEvaluators.order })
      .from(evalTestCaseEvaluators)
      .where(eq(evalTestCaseEvaluators.testCaseId, testCaseId))
      .orderBy(desc(evalTestCaseEvaluators.order))
      .limit(1);

    const nextOrder =
      existingOverrides.length > 0 ? existingOverrides[0].order + 1 : 0;

    const name = data.name ?? config.name;

    const [override] = await tx
      .insert(evalTestCaseEvaluators)
      .values({
        organizationId: orgId,
        testCaseId,
        evalConfigId: data.evalConfigId,
        overrideType: data.overrideType,
        name,
        order: nextOrder,
        required: data.required ?? true,
        source: "manual",
      })
      .returning();

    return override;
  });
}

/** Get effective evaluator list for a test case (AC 3). */
export async function getTestCaseEffectiveEvaluators(
  orgId: string,
  suiteId: string,
  testCaseId: string,
): Promise<
  Array<{
    id: string;
    evalConfigId: string;
    name: string;
    order: number;
    required: boolean;
    source: "inherited" | "auto" | "manual";
    overrideType?: "add" | "exclude";
    sopStepId?: string | null;
    tags: string[];
  }>
> {
  return forOrg(orgId, async (tx) => {
    // Validate test case belongs to suite
    const [testCase] = await tx
      .select({ id: evalSuiteTestCases.id })
      .from(evalSuiteTestCases)
      .where(
        and(
          eq(evalSuiteTestCases.id, testCaseId),
          eq(evalSuiteTestCases.suiteId, suiteId),
        ),
      );

    if (!testCase) {
      throw Errors.notFound("Test case not found in this suite");
    }

    // Load suite evaluators
    const suiteEvals = await loadSuiteEvaluators(tx, suiteId);

    // Load case overrides with live config name
    const overrides = await tx
      .select({
        override: evalTestCaseEvaluators,
        configName: evalConfigs.name,
      })
      .from(evalTestCaseEvaluators)
      .leftJoin(
        evalConfigs,
        eq(evalTestCaseEvaluators.evalConfigId, evalConfigs.id),
      )
      .where(eq(evalTestCaseEvaluators.testCaseId, testCaseId))
      .orderBy(asc(evalTestCaseEvaluators.order));

    // Build excluded config IDs
    const excludedConfigIds = new Set(
      overrides
        .filter((row) => row.override.overrideType === "exclude")
        .map((row) => row.override.evalConfigId),
    );

    // Start with inherited suite evaluators (minus excludes)
    const effective: Array<{
      id: string;
      evalConfigId: string;
      name: string;
      order: number;
      required: boolean;
      source: "inherited" | "auto" | "manual";
      overrideType?: "add" | "exclude";
      sopStepId?: string | null;
      tags: string[];
    }> = [];

    for (const se of suiteEvals) {
      if (excludedConfigIds.has(se.evalConfigId)) {
        const excludeRow = overrides.find(
          (row) =>
            row.override.evalConfigId === se.evalConfigId &&
            row.override.overrideType === "exclude",
        );
        effective.push({
          id: excludeRow?.override.id ?? se.id,
          evalConfigId: se.evalConfigId,
          name: se.configName ?? se.name,
          order: se.order,
          required: se.required,
          source: "inherited",
          overrideType: "exclude",
          sopStepId: se.sopStepId,
          tags: se.tags,
        });
      } else {
        effective.push({
          id: se.id,
          evalConfigId: se.evalConfigId,
          name: se.configName ?? se.name,
          order: se.order,
          required: se.required,
          source: "inherited",
          sopStepId: se.sopStepId,
          tags: se.tags,
        });
      }
    }

    // Append case-level adds
    const addRows = overrides.filter(
      (row) => row.override.overrideType === "add",
    );
    for (const { override: ao, configName } of addRows) {
      effective.push({
        id: ao.id,
        evalConfigId: ao.evalConfigId,
        name: configName ?? ao.name,
        order: ao.order,
        required: ao.required,
        source: "manual",
        overrideType: "add",
        tags: [],
      });
    }

    return effective;
  });
}

/**
 * Update the eval config referenced by a test-case-level evaluator override (AC-27).
 */
export async function updateTestCaseEvaluator(
  orgId: string,
  suiteId: string,
  testCaseId: string,
  overrideId: string,
  data: { evalConfigId: string },
): Promise<EvalTestCaseEvaluator> {
  return forOrg(orgId, async (tx) => {
    // Validate test case belongs to suite
    const [testCase] = await tx
      .select({ id: evalSuiteTestCases.id })
      .from(evalSuiteTestCases)
      .where(
        and(
          eq(evalSuiteTestCases.id, testCaseId),
          eq(evalSuiteTestCases.suiteId, suiteId),
        ),
      );

    if (!testCase) {
      throw Errors.notFound("Test case not found in this suite");
    }

    // Validate override belongs to test case
    const [override] = await tx
      .select()
      .from(evalTestCaseEvaluators)
      .where(
        and(
          eq(evalTestCaseEvaluators.id, overrideId),
          eq(evalTestCaseEvaluators.testCaseId, testCaseId),
        ),
      );

    if (!override) {
      throw Errors.notFound("Evaluator override not found");
    }

    // Validate the new eval config exists
    const [config] = await tx
      .select({ id: evalConfigs.id })
      .from(evalConfigs)
      .where(eq(evalConfigs.id, data.evalConfigId));

    if (!config) {
      throw Errors.notFound(`Eval config "${data.evalConfigId}" not found`);
    }

    const [updated] = await tx
      .update(evalTestCaseEvaluators)
      .set({ evalConfigId: data.evalConfigId })
      .where(eq(evalTestCaseEvaluators.id, overrideId))
      .returning();

    return updated;
  });
}

/** Delete a per-case evaluator override (AC 4). */
export async function deleteTestCaseEvaluator(
  orgId: string,
  suiteId: string,
  testCaseId: string,
  overrideId: string,
): Promise<void> {
  return forOrg(orgId, async (tx) => {
    // Validate test case belongs to suite
    const [testCase] = await tx
      .select({ id: evalSuiteTestCases.id })
      .from(evalSuiteTestCases)
      .where(
        and(
          eq(evalSuiteTestCases.id, testCaseId),
          eq(evalSuiteTestCases.suiteId, suiteId),
        ),
      );

    if (!testCase) {
      throw Errors.notFound("Test case not found in this suite");
    }

    const [override] = await tx
      .select({ id: evalTestCaseEvaluators.id })
      .from(evalTestCaseEvaluators)
      .where(
        and(
          eq(evalTestCaseEvaluators.id, overrideId),
          eq(evalTestCaseEvaluators.testCaseId, testCaseId),
        ),
      );

    if (!override) {
      throw Errors.notFound("Evaluator override not found");
    }

    await tx
      .delete(evalTestCaseEvaluators)
      .where(eq(evalTestCaseEvaluators.id, overrideId));
  });
}
