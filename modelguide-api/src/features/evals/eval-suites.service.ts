/**
 * Eval suite service — init, run, and query operations for evaluation suites.
 *
 * Evaluators belong to test cases, not suites. Each test case carries
 * only the evaluators relevant to the SOP path it exercises.
 */

import { type Transaction, forOrg } from "@db/rls";
import {
  type EvalRunScore,
  type EvalSuite,
  type EvalSuiteEvaluator,
  type EvalSuiteTestCase,
  agentKnowledgeBase,
  agentSops,
  agents,
  connectorTools,
  connectors,
  evalConfigs,
  evalRunScores,
  evalRuns,
  evalSuiteEvaluators,
  evalSuiteRuns,
  evalSuiteTestCases,
  evalSuites,
  knowledgeBase,
  sessionMessages,
  sessions,
  sopSteps,
  sops,
} from "@db/schema";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";

import type {
  CreateEvaluatorInput,
  CreateSuiteInput,
  CreateTestCaseInput,
  InitEvalSuiteOpts,
  ListEvalSuitesParams,
  RunEvalSuiteOpts,
  SuiteRunDetail,
  SuiteRunResult,
  TestCaseEvalResult,
  TestCaseRunDetail,
} from "./eval-suites.types";
import { extractConnectorToolIds } from "./evals.compile";
import { executeAssertions } from "./evals.service";
import { elapsedMs } from "./evals.time";
import type { EvalStatus, ResolvedAssertion } from "./evals.types";

const log = getLogger();

// ============================================================================
// Init Suite from SOP
// ============================================================================

function buildAutoEvalConfigName(
  evaluatorType: "tool_called" | "llm_judge",
  sopSlug: string,
  stepId: string,
): string {
  return `auto:${evaluatorType}:${sopSlug}:${stepId}`;
}

/**
 * Initialize (or re-initialize) an eval suite for an agent+SOP pair.
 *
 * - Derives test cases from SOP steps
 * - Creates evaluators per test case from step eval configs
 * - Loads agent guardrails and creates llm_judge evaluators for all test cases
 * - On re-init: preserves manual test cases, replaces auto-generated ones
 */
export async function initSuiteFromSop(
  orgId: string,
  agentId: string,
  sopId: string,
  opts?: InitEvalSuiteOpts,
): Promise<
  EvalSuite & {
    testCases: Awaited<ReturnType<typeof loadTestCasesWithEvaluators>>;
  }
> {
  return forOrg(orgId, async (tx) => {
    // 1a. Validate agent exists
    const [agent] = await tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId));

    if (!agent) throw Errors.agentNotFound(agentId);

    // 1b. Validate SOP exists
    const [sop] = await tx
      .select({ id: sops.id, name: sops.name, slug: sops.slug })
      .from(sops)
      .where(eq(sops.id, sopId));
    if (!sop) throw Errors.sopNotFound(sopId);

    // 1c. Validate SOP is assigned to agent
    const [assignment] = await tx
      .select({ agentId: agentSops.agentId })
      .from(agentSops)
      .where(and(eq(agentSops.agentId, agentId), eq(agentSops.sopId, sopId)));
    if (!assignment) {
      throw Errors.validationError(
        `SOP "${sop.name}" is not assigned to agent "${agent.name}"`,
      );
    }

    // 2. Check for existing suite (re-initialization)
    const [existingSuite] = await tx
      .select()
      .from(evalSuites)
      .where(and(eq(evalSuites.agentId, agentId), eq(evalSuites.sopId, sopId)));

    let suiteId: string;

    if (existingSuite) {
      suiteId = existingSuite.id;

      // Load existing auto test cases
      const autoTestCases = await tx
        .select({ id: evalSuiteTestCases.id })
        .from(evalSuiteTestCases)
        .where(
          and(
            eq(evalSuiteTestCases.suiteId, suiteId),
            eq(evalSuiteTestCases.source, "auto"),
          ),
        );

      // Delete auto test cases (cascade deletes their evaluators)
      for (const tc of autoTestCases) {
        await tx
          .delete(evalSuiteTestCases)
          .where(eq(evalSuiteTestCases.id, tc.id));
      }
    } else {
      // Create new suite
      const [newSuite] = await tx
        .insert(evalSuites)
        .values({
          organizationId: orgId,
          agentId,
          sopId,
          name: `Eval: ${sop.name}`,
          createdBy: opts?.createdBy,
        })
        .returning();
      suiteId = newSuite.id;
    }

    // 3. Load guardrails for this agent
    const guardrailEvaluatorConfigs = await loadGuardrailEvaluators(
      tx,
      orgId,
      agentId,
    );

    // 4. Load SOP steps with eval configs
    const stepRows = await tx
      .select({
        stepId: sopSteps.stepId,
        order: sopSteps.order,
        instruction: sopSteps.instruction,
        required: sopSteps.required,
        evalConfigId: sopSteps.evalConfigId,
        connectorToolId: sopSteps.connectorToolId,
      })
      .from(sopSteps)
      .where(eq(sopSteps.sopId, sopId))
      .orderBy(asc(sopSteps.order));

    // 5. Batch-load eval configs
    const evalConfigIds = [
      ...new Set(
        stepRows
          .map((s) => s.evalConfigId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const evalConfigRows =
      evalConfigIds.length > 0
        ? await tx
            .select()
            .from(evalConfigs)
            .where(inArray(evalConfigs.id, evalConfigIds))
        : [];

    const evalConfigMap = new Map(evalConfigRows.map((c) => [c.id, c]));

    // 6. Build single test case with evaluators for ALL steps
    const [testCase] = await tx
      .insert(evalSuiteTestCases)
      .values({
        organizationId: orgId,
        suiteId,
        name: `Eval: ${sop.name}`,
        description:
          "Auto-generated test case covering all SOP steps. Required steps have required evaluators; optional steps have optional evaluators.",
        source: "auto",
        order: 0,
      })
      .returning();

    // Create step-specific evaluators for ALL steps
    for (const step of stepRows) {
      let configId = step.evalConfigId;
      let evaluatorType: string | undefined;

      if (configId) {
        // Step already has an eval config — use it
        const cfg = evalConfigMap.get(configId);
        if (!cfg) continue;
        evaluatorType = cfg.evaluatorType;
      } else if (step.connectorToolId) {
        // Auto-create tool_called eval config
        const autoName = buildAutoEvalConfigName(
          "tool_called",
          sop.slug,
          step.stepId,
        );
        const [existing] = await tx
          .select({ id: evalConfigs.id })
          .from(evalConfigs)
          .where(
            and(
              eq(evalConfigs.name, autoName),
              eq(evalConfigs.evaluatorType, "tool_called"),
            ),
          );

        const toolConfig = { connectorToolId: step.connectorToolId };
        if (existing) {
          await tx
            .update(evalConfigs)
            .set({ config: toolConfig })
            .where(eq(evalConfigs.id, existing.id));
          configId = existing.id;
        } else {
          const [created] = await tx
            .insert(evalConfigs)
            .values({
              organizationId: orgId,
              name: autoName,
              description: `Auto-generated from SOP step: ${step.stepId}`,
              evaluatorType: "tool_called",
              config: toolConfig,
            })
            .returning({ id: evalConfigs.id });
          configId = created.id;
        }
        evaluatorType = "tool_called";
      } else if (step.instruction) {
        // Auto-create llm_judge eval config for instruction steps
        const autoName = buildAutoEvalConfigName(
          "llm_judge",
          sop.slug,
          step.stepId,
        );
        const [existing] = await tx
          .select({ id: evalConfigs.id })
          .from(evalConfigs)
          .where(
            and(
              eq(evalConfigs.name, autoName),
              eq(evalConfigs.evaluatorType, "llm_judge"),
            ),
          );

        const judgeConfig = {
          criterion: `The agent's response demonstrates that it correctly performed this step: "${step.instruction}". The agent does not need to explicitly state it performed this step — behavioral evidence is sufficient.`,
        };
        if (existing) {
          await tx
            .update(evalConfigs)
            .set({ config: judgeConfig })
            .where(eq(evalConfigs.id, existing.id));
          configId = existing.id;
        } else {
          const [created] = await tx
            .insert(evalConfigs)
            .values({
              organizationId: orgId,
              name: autoName,
              description: `Auto-generated from SOP step: ${step.stepId}`,
              evaluatorType: "llm_judge",
              config: judgeConfig,
            })
            .returning({ id: evalConfigs.id });
          configId = created.id;
        }
        evaluatorType = "llm_judge";
      } else {
        continue;
      }

      const stepLabel = step.instruction
        ? truncate(step.instruction, 80)
        : `step ${step.order}`;

      await tx.insert(evalSuiteEvaluators).values({
        organizationId: orgId,
        testCaseId: testCase.id,
        evalConfigId: configId!,
        name: `${stepLabel} (${evaluatorType})`,
        sopStepId: step.stepId,
        source: "auto",
        order: step.order,
        required: step.required,
      });
    }

    // Add guardrail KB evaluators
    for (let gi = 0; gi < guardrailEvaluatorConfigs.length; gi++) {
      const guardConfig = guardrailEvaluatorConfigs[gi];
      await tx.insert(evalSuiteEvaluators).values({
        organizationId: orgId,
        testCaseId: testCase.id,
        evalConfigId: guardConfig.id,
        name: `${guardConfig.guardrailName} (guardrail)`,
        source: "auto",
        order: 1000 + gi,
        required: true,
      });
    }

    // Return the suite with test cases
    const [suite] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    return {
      ...suite,
      testCases: await loadTestCasesWithEvaluators(tx, suiteId),
    };
  });
}

// ============================================================================
// Create Suite (manual)
// ============================================================================

/**
 * Create an empty eval suite. No SOP derivation — user populates test cases
 * and evaluators via the CRUD endpoints.
 */
export async function createSuite(
  orgId: string,
  data: CreateSuiteInput,
  opts?: { createdBy?: string },
): Promise<EvalSuite> {
  return forOrg(orgId, async (tx) => {
    // Validate agent exists
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, data.agentId));

    if (!agent) throw Errors.agentNotFound(data.agentId);

    const [suite] = await tx
      .insert(evalSuites)
      .values({
        organizationId: orgId,
        agentId: data.agentId,
        sopId: data.sopId ?? null,
        name: data.name,
        createdBy: opts?.createdBy,
      })
      .returning();

    return suite;
  });
}

/**
 * Load guardrails assigned to an agent and create eval_configs for them.
 * Returns eval_config rows (IDs) for guardrail-based llm_judge evaluators.
 */
async function loadGuardrailEvaluators(
  tx: Transaction,
  orgId: string,
  agentId: string,
): Promise<Array<{ id: string; guardrailName: string }>> {
  // Find guardrails assigned to this agent
  const kbAssignments = await tx
    .select({ knowledgeBaseId: agentKnowledgeBase.knowledgeBaseId })
    .from(agentKnowledgeBase)
    .where(eq(agentKnowledgeBase.agentId, agentId));

  if (kbAssignments.length === 0) return [];

  const kbIds = kbAssignments.map((a) => a.knowledgeBaseId);

  const guardrails = await tx
    .select()
    .from(knowledgeBase)
    .where(
      and(
        inArray(knowledgeBase.id, kbIds),
        eq(knowledgeBase.type, "guardrail"),
        eq(knowledgeBase.isActive, true),
      ),
    );

  if (guardrails.length === 0) return [];

  // Create or find eval_configs for each guardrail
  const configs: Array<{ id: string; guardrailName: string }> = [];
  for (const guardrail of guardrails) {
    // Check if a guardrail eval config already exists
    const configName = `guardrail:${guardrail.slug}`;
    const [existing] = await tx
      .select({ id: evalConfigs.id })
      .from(evalConfigs)
      .where(
        and(
          eq(evalConfigs.name, configName),
          eq(evalConfigs.evaluatorType, "llm_judge"),
        ),
      );

    const guardrailConfig = {
      criterion: `The agent must comply with this guardrail: ${guardrail.content}`,
    };
    if (existing) {
      // Update criterion in case guardrail content changed
      await tx
        .update(evalConfigs)
        .set({ config: guardrailConfig })
        .where(eq(evalConfigs.id, existing.id));
      configs.push({ ...existing, guardrailName: guardrail.name });
    } else {
      const [created] = await tx
        .insert(evalConfigs)
        .values({
          organizationId: orgId,
          name: configName,
          description: `Auto-generated from guardrail: ${guardrail.name}`,
          evaluatorType: "llm_judge",
          config: guardrailConfig,
        })
        .returning({ id: evalConfigs.id });
      configs.push({ ...created, guardrailName: guardrail.name });
    }
  }

  return configs;
}

/** Load test cases for a suite with their evaluators. */
async function loadTestCasesWithEvaluators(tx: Transaction, suiteId: string) {
  const cases = await tx
    .select()
    .from(evalSuiteTestCases)
    .where(eq(evalSuiteTestCases.suiteId, suiteId))
    .orderBy(asc(evalSuiteTestCases.order));

  if (cases.length === 0) return [];

  const caseIds = cases.map((c) => c.id);
  const evaluators = await tx
    .select()
    .from(evalSuiteEvaluators)
    .where(inArray(evalSuiteEvaluators.testCaseId, caseIds))
    .orderBy(asc(evalSuiteEvaluators.order));

  const evaluatorsByCase = new Map<string, EvalSuiteEvaluator[]>();
  for (const a of evaluators) {
    const list = evaluatorsByCase.get(a.testCaseId) ?? [];
    list.push(a);
    evaluatorsByCase.set(a.testCaseId, list);
  }

  return cases.map((c) => ({
    ...c,
    evaluators: evaluatorsByCase.get(c.id) ?? [],
  }));
}

// ============================================================================
// Resolve evaluators for execution
// ============================================================================

/**
 * Resolve evaluators for a specific test case into ready-to-execute form.
 * Loads eval_configs and resolves connector tool names.
 */
export async function resolveAssertions(
  tx: Transaction,
  testCaseId: string,
): Promise<ResolvedAssertion[]> {
  // Load assertions for this test case
  const assertions = await tx
    .select()
    .from(evalSuiteEvaluators)
    .where(eq(evalSuiteEvaluators.testCaseId, testCaseId))
    .orderBy(asc(evalSuiteEvaluators.order));

  if (assertions.length === 0) return [];

  // Batch-load eval configs
  const configIds = [...new Set(assertions.map((a) => a.evalConfigId))];
  const configs = await tx
    .select()
    .from(evalConfigs)
    .where(inArray(evalConfigs.id, configIds));

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

  // Build resolved assertions (canonical ResolvedAssertion shape)
  return assertions.map((a) => {
    const cfg = configMap.get(a.evalConfigId);
    if (!cfg) {
      return {
        order: a.order,
        name: a.name || `assertion:${a.order}:unknown`,
        required: a.required,
        evaluator: {
          configId: a.evalConfigId,
          evaluatorType: "llm_judge" as const,
          config: { criterion: "Unknown eval config" },
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
      order: a.order,
      name: a.name || `${truncate(cfg.evaluatorType, 40)}`,
      required: a.required,
      evaluator: {
        configId: cfg.id,
        evaluatorType:
          cfg.evaluatorType as ResolvedAssertion["evaluator"]["evaluatorType"],
        config: cfg.config as Record<string, unknown>,
      },
      toolNameMap: stepToolNameMap,
    };
  });
}

// ============================================================================
// Run Suite
// ============================================================================

/** Truncate instruction to N chars for score name. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

/**
 * Run an entire eval suite — executes each test case's assertions
 * against a session, creating eval_runs per test case.
 */
export async function runEvalSuite(
  orgId: string,
  suiteId: string,
  sessionId: string,
  promptSource: string,
  opts?: RunEvalSuiteOpts,
): Promise<SuiteRunResult> {
  const startTime = performance.now();

  // 1. Load suite and test cases with validations
  const suiteData = await forOrg(orgId, async (tx) => {
    const [suite] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

    if (suite.status === "archived") {
      throw Errors.conflict(
        `Eval suite "${suiteId}" is archived and cannot be run`,
      );
    }

    const [agent] = await tx
      .select({
        id: agents.id,
        compiledInstructions: agents.compiledInstructions,
      })
      .from(agents)
      .where(eq(agents.id, suite.agentId));

    if (!agent) throw Errors.agentNotFound(suite.agentId);

    if (!agent.compiledInstructions) {
      throw Errors.validationError(
        `Agent "${suite.agentId}" has no compiled_instructions — compile the SOP first`,
      );
    }

    // Validate session exists and is terminal
    const [session] = await tx
      .select({
        id: sessions.id,
        agentId: sessions.agentId,
        status: sessions.status,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) {
      throw Errors.notFound(`Session "${sessionId}" not found`);
    }

    if (session.agentId !== suite.agentId) {
      throw Errors.validationError(
        `Session "${sessionId}" belongs to agent "${session.agentId}", not suite agent "${suite.agentId}"`,
      );
    }

    if (session.status === "active") {
      throw Errors.validationError(
        `Session "${sessionId}" is still active — wait for it to complete before running evals`,
      );
    }

    const testCases = await tx
      .select()
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId))
      .orderBy(asc(evalSuiteTestCases.order));

    if (testCases.length === 0) {
      throw Errors.validationError(
        `Eval suite "${suiteId}" has no test cases — initialize the suite first`,
      );
    }

    const testCaseIds = testCases.map((tc) => tc.id);
    const evaluatorCounts = await tx
      .select({
        testCaseId: evalSuiteEvaluators.testCaseId,
        count: count(),
      })
      .from(evalSuiteEvaluators)
      .where(inArray(evalSuiteEvaluators.testCaseId, testCaseIds))
      .groupBy(evalSuiteEvaluators.testCaseId);

    const evaluatorCountMap = new Map(
      evaluatorCounts.map((a) => [a.testCaseId, a.count]),
    );
    for (const tc of testCases) {
      if (!evaluatorCountMap.has(tc.id) || evaluatorCountMap.get(tc.id) === 0) {
        throw Errors.validationError(
          `Test case "${tc.name}" has no evaluators`,
        );
      }
    }

    return { suite, testCases };
  });

  // 2. Create suite run
  const [suiteRun] = await forOrg(orgId, (tx) =>
    tx
      .insert(evalSuiteRuns)
      .values({
        organizationId: orgId,
        suiteId,
        promptSource,
        triggeredBy: opts?.triggeredBy,
      })
      .returning(),
  );

  // 3. For each test case, resolve assertions and run evaluation
  const results: TestCaseEvalResult[] = [];

  for (const testCase of suiteData.testCases) {
    try {
      const result = await runTestCaseEval(
        orgId,
        suiteData.suite,
        testCase,
        suiteRun.id,
        sessionId,
        opts,
      );
      results.push(result);
    } catch (err) {
      log.warn(
        { err, testCaseId: testCase.id, suiteRunId: suiteRun.id },
        "test case evaluation failed",
      );
      results.push({
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        evalRunId: null,
        passed: null,
        scores: [],
      });
    }
  }

  // 4. Determine suite run status and mark completed
  const durationMs = elapsedMs(startTime);
  const erroredCount = results.filter((r) => r.passed === null).length;
  const runStatus =
    erroredCount === results.length
      ? ("failed" as const)
      : erroredCount > 0
        ? ("completed_with_errors" as const)
        : ("completed" as const);

  await forOrg(orgId, (tx) =>
    tx
      .update(evalSuiteRuns)
      .set({ status: runStatus, completedAt: new Date(), durationMs })
      .where(eq(evalSuiteRuns.id, suiteRun.id)),
  );

  return {
    suiteRun: { ...suiteRun, status: runStatus, completedAt: new Date() },
    results,
    durationMs,
  };
}

/**
 * Evaluate an existing session against a test case's resolved assertions.
 */
async function runTestCaseEval(
  orgId: string,
  suite: EvalSuite,
  testCase: EvalSuiteTestCase,
  suiteRunId: string,
  sessionId: string,
  opts?: RunEvalSuiteOpts,
): Promise<TestCaseEvalResult> {
  return forOrg(orgId, async (tx) => {
    // Resolve assertions for this test case
    const resolved = await resolveAssertions(tx, testCase.id);

    // Create eval run linked to suite run and test case
    const [evalRun] = await tx
      .insert(evalRuns)
      .values({
        organizationId: orgId,
        sessionId,
        sourceType: "suite",
        sourceId: suite.id,
        status: "running",
        triggeredBy: opts?.triggeredBy,
        suiteRunId,
        testCaseId: testCase.id,
      })
      .returning();

    // Load messages
    const messages = await tx
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.occurredAt), asc(sessionMessages.createdAt));

    // Execute assertions using shared scoring engine
    const evalStartTime = performance.now();
    const { scoreRows } = await executeAssertions(
      resolved,
      messages,
      evalRun.id,
      orgId,
    );

    const failedRequired = scoreRows.filter(
      (s) => s.required && (s.result === "fail" || s.result === "error"),
    );
    const allSkipped = scoreRows.every((s) => s.result === "skip");
    // If all evaluators were skipped, the result is inconclusive (null)
    const passed = allSkipped ? null : failedRequired.length === 0;
    const durationMs = elapsedMs(evalStartTime);

    // Persist scores and update eval run
    if (scoreRows.length > 0) {
      await tx.insert(evalRunScores).values(scoreRows);
    }

    await tx
      .update(evalRuns)
      .set({
        status: "completed" as EvalStatus,
        passed,
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(evalRuns.id, evalRun.id));

    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      evalRunId: evalRun.id,
      passed,
      scores: scoreRows,
    };
  });
}

// ============================================================================
// Queries
// ============================================================================

/** Get a single eval suite by ID, including test cases and evaluators. */
export async function getEvalSuiteById(
  orgId: string,
  suiteId: string,
): Promise<
  EvalSuite & {
    testCases: Awaited<ReturnType<typeof loadTestCasesWithEvaluators>>;
  }
> {
  return forOrg(orgId, async (tx) => {
    const [suite] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

    const testCases = await loadTestCasesWithEvaluators(tx, suiteId);

    return { ...suite, testCases };
  });
}

/** List eval suites with optional agent/SOP filters and pagination. */
export async function listEvalSuites(
  orgId: string,
  params: ListEvalSuitesParams,
): Promise<{
  data: EvalSuite[];
  pagination: ReturnType<typeof buildPaginationMeta>;
}> {
  const { page, pageSize, agentId, sopId } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (agentId) conditions.push(eq(evalSuites.agentId, agentId));
    if (sopId) conditions.push(eq(evalSuites.sopId, sopId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(evalSuites)
        .where(where)
        .orderBy(desc(evalSuites.createdAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(evalSuites).where(where),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

/** Delete an eval suite and all its test cases, evaluators, and runs. */
export async function deleteEvalSuite(
  orgId: string,
  suiteId: string,
): Promise<void> {
  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!existing) throw Errors.evalSuiteNotFound(suiteId);

    await tx.delete(evalSuites).where(eq(evalSuites.id, suiteId));
  });
}

// ============================================================================
// Manual Test Case & Evaluator CRUD
// ============================================================================

/** Create a manual test case for an existing suite. */
export async function createTestCase(
  orgId: string,
  suiteId: string,
  data: CreateTestCaseInput,
): Promise<EvalSuiteTestCase> {
  return forOrg(orgId, async (tx) => {
    const [suite] = await tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

    // Determine next order
    const existing = await tx
      .select({ order: evalSuiteTestCases.order })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId))
      .orderBy(desc(evalSuiteTestCases.order))
      .limit(1);

    const nextOrder = existing.length > 0 ? existing[0].order + 1 : 0;

    const [testCase] = await tx
      .insert(evalSuiteTestCases)
      .values({
        organizationId: orgId,
        suiteId,
        name: data.name,
        description: data.description ?? null,
        source: "manual",
        input: data.input ?? null,
        expectedBehavior: data.expectedBehavior ?? null,
        order: nextOrder,
      })
      .returning();

    return testCase;
  });
}

/** Create a manual evaluator for an existing test case. */
export async function createEvaluator(
  orgId: string,
  suiteId: string,
  testCaseId: string,
  data: CreateEvaluatorInput,
): Promise<EvalSuiteEvaluator> {
  return forOrg(orgId, async (tx) => {
    // Validate suite exists
    const [suite] = await tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

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
      throw Errors.notFound(
        `Test case "${testCaseId}" not found in suite "${suiteId}"`,
      );
    }

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
      .where(eq(evalSuiteEvaluators.testCaseId, testCaseId))
      .orderBy(desc(evalSuiteEvaluators.order))
      .limit(1);

    const nextOrder = existing.length > 0 ? existing[0].order + 1 : 0;

    const [assertion] = await tx
      .insert(evalSuiteEvaluators)
      .values({
        organizationId: orgId,
        testCaseId,
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

// ============================================================================
// Suite Runs Queries
// ============================================================================

/** List suite runs with per-test-case breakdown and pagination. */
export async function getEvalSuiteRuns(
  orgId: string,
  suiteId: string,
  params: PaginationParams,
): Promise<{
  data: Array<Awaited<ReturnType<typeof getEvalSuiteRunById>>>;
  pagination: ReturnType<typeof buildPaginationMeta>;
}> {
  const { page, pageSize } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    // Verify suite exists
    const [suite] = await tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

    const [runs, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(evalSuiteRuns)
        .where(eq(evalSuiteRuns.suiteId, suiteId))
        .orderBy(desc(evalSuiteRuns.startedAt))
        .limit(pageSize)
        .offset(offset),
      tx
        .select({ total: count() })
        .from(evalSuiteRuns)
        .where(eq(evalSuiteRuns.suiteId, suiteId)),
    ]);

    // Load test case names for this suite
    const testCaseRows = await tx
      .select({ id: evalSuiteTestCases.id, name: evalSuiteTestCases.name })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId));
    const testCaseNameMap = new Map(testCaseRows.map((tc) => [tc.id, tc.name]));

    // For each run, load per-test-case eval results
    const enrichedRuns = await Promise.all(
      runs.map(async (run) => {
        // Load eval runs linked to this suite run
        const linkedEvalRuns = await tx
          .select()
          .from(evalRuns)
          .where(eq(evalRuns.suiteRunId, run.id))
          .orderBy(asc(evalRuns.createdAt));

        // Load scores for these eval runs
        const evalRunIds = linkedEvalRuns.map((r) => r.id);
        const scores =
          evalRunIds.length > 0
            ? await tx
                .select()
                .from(evalRunScores)
                .where(inArray(evalRunScores.evalRunId, evalRunIds))
                .orderBy(asc(evalRunScores.scoreOrder))
            : [];

        // Group scores by eval run
        const scoresByRun = new Map<string, EvalRunScore[]>();
        for (const s of scores) {
          const list = scoresByRun.get(s.evalRunId) ?? [];
          list.push(s);
          scoresByRun.set(s.evalRunId, list);
        }

        // Build per-test-case results
        const testCaseResults: TestCaseRunDetail[] = linkedEvalRuns.map(
          (er) => ({
            testCaseId: er.testCaseId,
            testCaseName: er.testCaseId
              ? (testCaseNameMap.get(er.testCaseId) ?? null)
              : null,
            evalRunId: er.id,
            passed: er.passed,
            status: er.status,
            scores: scoresByRun.get(er.id) ?? [],
          }),
        );

        // Aggregate pass/fail at query time (three-state: true/false/null)
        const completedRuns = linkedEvalRuns.filter(
          (r) => r.status === "completed",
        );
        const anyFailed = completedRuns.some((r) => r.passed === false);
        const allInconclusive =
          completedRuns.length > 0 &&
          completedRuns.every((r) => r.passed == null);
        const passed =
          completedRuns.length === 0 || allInconclusive ? null : !anyFailed;

        const sessionId = linkedEvalRuns[0]?.sessionId ?? null;

        return {
          ...run,
          sessionId,
          passed,
          testCaseResults,
        };
      }),
    );

    return {
      data: enrichedRuns,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

/** Get a single suite run by ID with per-test-case results and scores. */
export async function getEvalSuiteRunById(
  orgId: string,
  suiteId: string,
  runId: string,
): Promise<SuiteRunDetail> {
  return forOrg(orgId, async (tx) => {
    const [run] = await tx
      .select()
      .from(evalSuiteRuns)
      .where(
        and(eq(evalSuiteRuns.id, runId), eq(evalSuiteRuns.suiteId, suiteId)),
      );

    if (!run) throw Errors.evalSuiteRunNotFound(runId);

    // Load test case names
    const testCaseRows = await tx
      .select({ id: evalSuiteTestCases.id, name: evalSuiteTestCases.name })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId));
    const testCaseNameMap = new Map(testCaseRows.map((tc) => [tc.id, tc.name]));

    // Load per-test-case results with scores
    const linkedEvalRuns = await tx
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.suiteRunId, runId))
      .orderBy(asc(evalRuns.createdAt));

    const evalRunIds = linkedEvalRuns.map((r) => r.id);
    const scores =
      evalRunIds.length > 0
        ? await tx
            .select()
            .from(evalRunScores)
            .where(inArray(evalRunScores.evalRunId, evalRunIds))
            .orderBy(asc(evalRunScores.scoreOrder))
        : [];

    const scoresByRun = new Map<string, EvalRunScore[]>();
    for (const s of scores) {
      const list = scoresByRun.get(s.evalRunId) ?? [];
      list.push(s);
      scoresByRun.set(s.evalRunId, list);
    }

    const testCaseResults: TestCaseRunDetail[] = linkedEvalRuns.map((er) => ({
      testCaseId: er.testCaseId,
      testCaseName: er.testCaseId
        ? (testCaseNameMap.get(er.testCaseId) ?? null)
        : null,
      evalRunId: er.id,
      passed: er.passed,
      status: er.status,
      scores: scoresByRun.get(er.id) ?? [],
    }));

    const completedRuns = linkedEvalRuns.filter(
      (r) => r.status === "completed",
    );
    const anyFailed = completedRuns.some((r) => r.passed === false);
    const allInconclusive =
      completedRuns.length > 0 && completedRuns.every((r) => r.passed == null);
    const passed =
      completedRuns.length === 0 || allInconclusive ? null : !anyFailed;

    // Derive sessionId from linked eval runs (all share the same session)
    const sessionId = linkedEvalRuns[0]?.sessionId ?? null;

    return {
      ...run,
      sessionId,
      passed,
      testCaseResults,
    };
  });
}
