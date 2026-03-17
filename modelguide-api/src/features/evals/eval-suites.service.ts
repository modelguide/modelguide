/**
 * Eval suite service — init, run, and query operations for evaluation suites.
 *
 * Assertions belong to test cases, not suites. Each test case carries
 * only the assertions relevant to the SOP path it exercises.
 */

import { type Transaction, forOrg } from "@db/rls";
import {
  type EvalRunScore,
  type EvalSuite,
  type EvalSuiteAssertion,
  type EvalSuiteTestCase,
  agentKnowledgeBase,
  agents,
  connectorTools,
  connectors,
  evalConfigs,
  evalRunScores,
  evalRuns,
  evalSuiteAssertions,
  evalSuiteRuns,
  evalSuiteTestCases,
  evalSuites,
  knowledgeBase,
  sessionMessages,
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
  CreateAssertionInput,
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

/**
 * Initialize (or re-initialize) an eval suite for an agent+SOP pair.
 *
 * - Derives test cases from SOP steps
 * - Creates assertions per test case from step eval configs
 * - Loads agent guardrails and creates llm_judge assertions for all test cases
 * - On re-init: preserves manual test cases, replaces auto-generated ones
 */
export async function initSuiteFromSop(
  orgId: string,
  agentId: string,
  sopId: string,
  opts?: InitEvalSuiteOpts,
): Promise<
  EvalSuite & {
    testCases: Awaited<ReturnType<typeof loadTestCasesWithAssertions>>;
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
      .select({ id: sops.id, name: sops.name })
      .from(sops)
      .where(eq(sops.id, sopId));
    if (!sop) throw Errors.sopNotFound(sopId);

    // 2. Check for existing suite (re-initialization)
    const [existingSuite] = await tx
      .select()
      .from(evalSuites)
      .where(and(eq(evalSuites.agentId, agentId), eq(evalSuites.sopId, sopId)));

    let suiteId: string;

    if (existingSuite) {
      suiteId = existingSuite.id;

      // Delete auto-generated test cases (cascade deletes their assertions)
      await tx
        .delete(evalSuiteTestCases)
        .where(
          and(
            eq(evalSuiteTestCases.suiteId, suiteId),
            eq(evalSuiteTestCases.source, "auto"),
          ),
        );
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
    const guardrailAssertionConfigs = await loadGuardrailAssertions(
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

    // 6. Build path-based test cases
    //
    // Classify steps:
    //   - requiredSteps: steps with required: true
    //   - optionalToolSteps: steps with required: false AND a connectorToolId (escalation branch)
    //   - requiredInstructionSteps: required steps without a connectorToolId
    //
    // Test case paths:
    //   - happy_path:  assertions for all required steps
    //   - edge_case:   same assertions, different category (for varied inputs)
    //   - guardrail:   required instruction steps + optional tool steps (escalation path)

    const requiredSteps = stepRows.filter((s) => s.required);
    const optionalToolSteps = stepRows.filter(
      (s) => !s.required && s.connectorToolId,
    );
    const requiredInstructionSteps = requiredSteps.filter(
      (s) => !s.connectorToolId,
    );

    type SopStepRow = (typeof stepRows)[number];

    const paths: Array<{
      name: string;
      category: string;
      description: string;
      steps: SopStepRow[];
    }> = [
      {
        name: "Happy path",
        category: "happy_path",
        description:
          "All required steps execute successfully in the expected order.",
        steps: requiredSteps,
      },
      {
        name: "Edge case",
        category: "edge_case",
        description:
          "Same required steps but with unusual or boundary-condition inputs.",
        steps: requiredSteps,
      },
      {
        name: "Guardrail path",
        category: "guardrail",
        description:
          "Required instruction steps plus optional escalation/tool steps.",
        steps: [...requiredInstructionSteps, ...optionalToolSteps],
      },
    ];

    const testCases: Array<EvalSuiteTestCase> = [];

    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi];

      // Create path-based test case
      const [testCase] = await tx
        .insert(evalSuiteTestCases)
        .values({
          organizationId: orgId,
          suiteId,
          name: `${path.name}: ${sop.name}`,
          description: path.description,
          category: path.category,
          source: "auto",
          order: pi,
        })
        .returning();

      testCases.push(testCase);

      // Create step-specific assertions for this path's steps
      for (const step of path.steps) {
        let configId = step.evalConfigId;
        let evaluatorType: string | undefined;

        if (configId) {
          // Step already has an eval config — use it
          const cfg = evalConfigMap.get(configId);
          if (!cfg) continue;
          evaluatorType = cfg.evaluatorType;
        } else if (step.connectorToolId) {
          // Auto-create tool_called eval config
          const autoName = `auto:tool_called:${step.stepId}`;
          const [existing] = await tx
            .select({ id: evalConfigs.id })
            .from(evalConfigs)
            .where(
              and(
                eq(evalConfigs.name, autoName),
                eq(evalConfigs.evaluatorType, "tool_called"),
              ),
            );

          if (existing) {
            configId = existing.id;
          } else {
            const [created] = await tx
              .insert(evalConfigs)
              .values({
                organizationId: orgId,
                name: autoName,
                description: `Auto-generated from SOP step: ${step.stepId}`,
                evaluatorType: "tool_called",
                config: { connectorToolId: step.connectorToolId },
              })
              .returning({ id: evalConfigs.id });
            configId = created.id;
          }
          evaluatorType = "tool_called";
        } else if (step.instruction && step.required) {
          // Auto-create llm_judge eval config for required instruction steps
          const autoName = `auto:llm_judge:${step.stepId}`;
          const [existing] = await tx
            .select({ id: evalConfigs.id })
            .from(evalConfigs)
            .where(
              and(
                eq(evalConfigs.name, autoName),
                eq(evalConfigs.evaluatorType, "llm_judge"),
              ),
            );

          if (existing) {
            configId = existing.id;
          } else {
            const [created] = await tx
              .insert(evalConfigs)
              .values({
                organizationId: orgId,
                name: autoName,
                description: `Auto-generated from SOP step: ${step.stepId}`,
                evaluatorType: "llm_judge",
                config: {
                  criterion: `The agent's response demonstrates that it correctly performed this step: "${step.instruction}". The agent does not need to explicitly state it performed this step — behavioral evidence is sufficient.`,
                },
              })
              .returning({ id: evalConfigs.id });
            configId = created.id;
          }
          evaluatorType = "llm_judge";
        } else {
          // Optional instruction-only step with no tool — skip
          continue;
        }

        const isOptional = !step.required;
        const assertionRequired =
          evaluatorType === "tool_called" && isOptional ? false : step.required;

        await tx.insert(evalSuiteAssertions).values({
          organizationId: orgId,
          testCaseId: testCase.id,
          evalConfigId: configId!,
          name: `step:${step.order}:${evaluatorType}`,
          sopStepId: step.stepId,
          source: "auto",
          order: step.order,
          required: assertionRequired,
        });
      }

      // Add guardrail KB assertions to every test case
      for (let gi = 0; gi < guardrailAssertionConfigs.length; gi++) {
        const guardConfig = guardrailAssertionConfigs[gi];
        await tx.insert(evalSuiteAssertions).values({
          organizationId: orgId,
          testCaseId: testCase.id,
          evalConfigId: guardConfig.id,
          name: `guardrail:${gi}`,
          source: "auto",
          order: 1000 + gi,
          required: true,
        });
      }
    }

    // Return the suite with test cases
    const [suite] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    return {
      ...suite,
      testCases: await loadTestCasesWithAssertions(tx, suiteId),
    };
  });
}

// ============================================================================
// Create Suite (manual)
// ============================================================================

/**
 * Create an empty eval suite. No SOP derivation — user populates test cases
 * and assertions via the CRUD endpoints.
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
 * Returns eval_config rows (IDs) for guardrail-based llm_judge assertions.
 */
async function loadGuardrailAssertions(
  tx: Transaction,
  orgId: string,
  agentId: string,
): Promise<Array<{ id: string }>> {
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
  const configs: Array<{ id: string }> = [];
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

    if (existing) {
      configs.push(existing);
    } else {
      const [created] = await tx
        .insert(evalConfigs)
        .values({
          organizationId: orgId,
          name: configName,
          description: `Auto-generated from guardrail: ${guardrail.name}`,
          evaluatorType: "llm_judge",
          config: {
            criterion: `The agent must comply with this guardrail: ${guardrail.content}`,
          },
        })
        .returning({ id: evalConfigs.id });
      configs.push(created);
    }
  }

  return configs;
}

/** Load test cases for a suite with their assertions. */
async function loadTestCasesWithAssertions(tx: Transaction, suiteId: string) {
  const cases = await tx
    .select()
    .from(evalSuiteTestCases)
    .where(eq(evalSuiteTestCases.suiteId, suiteId))
    .orderBy(asc(evalSuiteTestCases.order));

  if (cases.length === 0) return [];

  const caseIds = cases.map((c) => c.id);
  const assertions = await tx
    .select()
    .from(evalSuiteAssertions)
    .where(inArray(evalSuiteAssertions.testCaseId, caseIds))
    .orderBy(asc(evalSuiteAssertions.order));

  const assertionsByCase = new Map<string, EvalSuiteAssertion[]>();
  for (const a of assertions) {
    const list = assertionsByCase.get(a.testCaseId) ?? [];
    list.push(a);
    assertionsByCase.set(a.testCaseId, list);
  }

  return cases.map((c) => ({
    ...c,
    assertions: assertionsByCase.get(c.id) ?? [],
  }));
}

// ============================================================================
// Resolve assertions for execution
// ============================================================================

/**
 * Resolve assertions for a specific test case into ready-to-execute form.
 * Loads eval_configs and resolves connector tool names.
 */
export async function resolveAssertions(
  tx: Transaction,
  testCaseId: string,
): Promise<ResolvedAssertion[]> {
  // Load assertions for this test case
  const assertions = await tx
    .select()
    .from(evalSuiteAssertions)
    .where(eq(evalSuiteAssertions.testCaseId, testCaseId))
    .orderBy(asc(evalSuiteAssertions.order));

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
        name: `assertion:${a.order}:unknown`,
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
      name: `assertion:${a.order}:${truncate(cfg.evaluatorType, 40)}`,
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
    const assertionCounts = await tx
      .select({
        testCaseId: evalSuiteAssertions.testCaseId,
        count: count(),
      })
      .from(evalSuiteAssertions)
      .where(inArray(evalSuiteAssertions.testCaseId, testCaseIds))
      .groupBy(evalSuiteAssertions.testCaseId);

    const assertionCountMap = new Map(
      assertionCounts.map((a) => [a.testCaseId, a.count]),
    );
    for (const tc of testCases) {
      if (!assertionCountMap.has(tc.id) || assertionCountMap.get(tc.id) === 0) {
        throw Errors.validationError(
          `Test case "${tc.name}" has no assertions`,
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

  // 4. Mark suite run as completed
  const durationMs = elapsedMs(startTime);

  await forOrg(orgId, (tx) =>
    tx
      .update(evalSuiteRuns)
      .set({ completedAt: new Date(), durationMs })
      .where(eq(evalSuiteRuns.id, suiteRun.id)),
  );

  return {
    suiteRun: { ...suiteRun, completedAt: new Date() },
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
    const passed = failedRequired.length === 0;
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

/** Get a single eval suite by ID, including test cases and assertions. */
export async function getEvalSuiteById(
  orgId: string,
  suiteId: string,
): Promise<
  EvalSuite & {
    testCases: Awaited<ReturnType<typeof loadTestCasesWithAssertions>>;
  }
> {
  return forOrg(orgId, async (tx) => {
    const [suite] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!suite) throw Errors.evalSuiteNotFound(suiteId);

    const testCases = await loadTestCasesWithAssertions(tx, suiteId);

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

/** Delete an eval suite and all its test cases, assertions, and runs. */
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
// Manual Test Case & Assertion CRUD
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
        category: data.category ?? null,
        source: "manual",
        input: data.input ?? null,
        expectedBehavior: data.expectedBehavior ?? null,
        order: nextOrder,
      })
      .returning();

    return testCase;
  });
}

/** Create a manual assertion for an existing test case. */
export async function createAssertion(
  orgId: string,
  suiteId: string,
  testCaseId: string,
  data: CreateAssertionInput,
): Promise<EvalSuiteAssertion> {
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
      .select({ order: evalSuiteAssertions.order })
      .from(evalSuiteAssertions)
      .where(eq(evalSuiteAssertions.testCaseId, testCaseId))
      .orderBy(desc(evalSuiteAssertions.order))
      .limit(1);

    const nextOrder = existing.length > 0 ? existing[0].order + 1 : 0;

    const [assertion] = await tx
      .insert(evalSuiteAssertions)
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
            evalRunId: er.id,
            passed: er.passed,
            status: er.status,
            scores: scoresByRun.get(er.id) ?? [],
          }),
        );

        // Aggregate pass/fail at query time
        const completedRuns = linkedEvalRuns.filter(
          (r) => r.status === "completed",
        );
        const allPassed =
          completedRuns.length > 0 &&
          completedRuns.every((r) => r.passed === true);

        return {
          ...run,
          passed: completedRuns.length > 0 ? allPassed : null,
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
  runId: string,
): Promise<SuiteRunDetail> {
  return forOrg(orgId, async (tx) => {
    const [run] = await tx
      .select()
      .from(evalSuiteRuns)
      .where(eq(evalSuiteRuns.id, runId));

    if (!run) throw Errors.evalSuiteRunNotFound(runId);

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
      evalRunId: er.id,
      passed: er.passed,
      status: er.status,
      scores: scoresByRun.get(er.id) ?? [],
    }));

    const completedRuns = linkedEvalRuns.filter(
      (r) => r.status === "completed",
    );
    const allPassed =
      completedRuns.length > 0 && completedRuns.every((r) => r.passed === true);

    return {
      ...run,
      passed: completedRuns.length > 0 ? allPassed : null,
      testCaseResults,
    };
  });
}
