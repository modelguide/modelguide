/**
 * Simulate-and-run service — async pipeline that simulates conversations
 * per test case via MCP mock tools, then scores each session.
 *
 * Extracted from eval-suites.service.ts to keep file sizes manageable.
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import {
  agents,
  evalRuns,
  evalSuiteRuns,
  evalSuiteTestCases,
  evalSuites,
} from "@db/schema";
import { createSession } from "@features/sessions/sessions.service";
import { MastraAdapter } from "@features/simulations/adapters/mastra-adapter";
import { runEvalSimulation } from "@features/simulations/eval-orchestrator";
import { personalizeInputMessage } from "@features/simulations/llm-client";
import {
  getPersona,
  personaToIdentifier,
} from "@features/simulations/personas";
import { Errors } from "@lib/errors";
import { generateSimulationJWT } from "@lib/jwt";
import { getLogger } from "@lib/logger";
import { taskRunner } from "@lib/task-runner";
import { asc, eq } from "drizzle-orm";

import { compileAgent } from "@features/compiler/compiler.service";

import { runTestCaseEval } from "./eval-suites.service";
import type {
  RecordedTestCaseInput,
  RunEvalSuiteOpts,
  SimulateAndRunPayload,
  SimulationTestCaseInput,
  TestCaseEvalResult,
} from "./eval-suites.types";
import { elapsedMs } from "./evals.time";
import type { EvalStatus } from "./evals.types";

const log = getLogger();

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate suite + agent, create a run record, and enqueue the async
 * simulate-and-run task. Returns immediately (HTTP 202 pattern).
 *
 * Only cheap checks live here so the caller gets an immediate 400/404/409.
 */
export async function enqueueSimulateAndRun(
  orgId: string,
  suiteId: string,
  promptSource: string,
  opts?: RunEvalSuiteOpts & { testCaseIds?: string[] },
): Promise<{ suiteRunId: string }> {
  // Validate + create suite run in a single transaction (avoids TOCTOU race)
  const suiteRun = await forOrg(orgId, async (tx) => {
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

    let testCases = await tx
      .select({
        id: evalSuiteTestCases.id,
        name: evalSuiteTestCases.name,
        input: evalSuiteTestCases.input,
        source: evalSuiteTestCases.source,
      })
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId));

    if (testCases.length === 0) {
      throw Errors.validationError(
        `Eval suite "${suiteId}" has no test cases — initialize the suite first`,
      );
    }

    // Filter to specific test cases if requested
    if (opts?.testCaseIds && opts.testCaseIds.length > 0) {
      const requestedIds = new Set(opts.testCaseIds);
      testCases = testCases.filter((tc) => requestedIds.has(tc.id));
      if (testCases.length === 0) {
        throw Errors.validationError(
          "None of the specified testCaseIds match test cases in this suite",
        );
      }
    }

    for (const tc of testCases) {
      // Recorded test cases don't need input.message — they use their stored session
      if (tc.source === "recorded") continue;
      const input = tc.input as SimulationTestCaseInput | null;
      if (!input?.message) {
        throw Errors.validationError(
          `Test case "${tc.name}" missing required input.message for simulation`,
        );
      }
    }

    const [run] = await tx
      .insert(evalSuiteRuns)
      .values({
        organizationId: orgId,
        suiteId,
        promptSource,
        triggeredBy: opts?.triggeredBy,
        metadata: {
          progress: {
            completed: 0,
            total: testCases.length,
            currentTestCase: null,
          },
        },
      })
      .returning();

    return run;
  });

  const concurrency = resolveEvalConcurrency(opts?.concurrency);

  // Enqueue — actual simulation + scoring happens asynchronously
  // TODO: migrate to background job (BullMQ) when concurrent load requires it
  taskRunner.enqueue(
    "simulate-and-run",
    {
      orgId,
      suiteId,
      suiteRunId: suiteRun.id,
      promptSource,
      triggeredBy: opts?.triggeredBy,
      testCaseIds: opts?.testCaseIds,
      concurrency,
    },
    executeSimulateAndRun,
  );

  return { suiteRunId: suiteRun.id };
}

/**
 * Determine suite run status from test case results.
 *
 * - `failed` when all test cases errored (passed === null)
 * - `completed_with_errors` when ≥1 errored but not all
 * - `completed` when all succeeded
 */
export function determineSuiteRunStatus(
  results: TestCaseEvalResult[],
): "completed" | "completed_with_errors" | "failed" {
  const totalErrored = results.filter((r) => r.passed === null).length;
  if (totalErrored === results.length) return "failed";
  if (totalErrored > 0) return "completed_with_errors";
  return "completed";
}

/**
 * Resolve and clamp per-suite test-case concurrency.
 *
 * Precedence: explicit `opt` > `env.EVAL_CONCURRENCY`. Clamped to [1, 20]
 * so a runaway caller can't DDoS the LLM providers.
 */
export function resolveEvalConcurrency(opt?: number): number {
  const raw = opt ?? env.EVAL_CONCURRENCY;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

/**
 * Run a bounded worker pool over `total` items.
 *
 * Semantics:
 * - up to `concurrency` workers pull from a shared cursor — effective pool
 *   size is `min(concurrency, total)`; `total === 0` returns immediately.
 * - `runOne(index)` is expected to capture its own errors (store a result
 *   in caller-owned state). Any escape is funnelled through `onError` so
 *   `Promise.all` always resolves and peer workers keep running.
 * - `onBeforeRun` fires before each dispatch; instrumentation failures are
 *   swallowed (logging should never take down a suite).
 */
export async function runBoundedPool(
  total: number,
  concurrency: number,
  runOne: (index: number) => Promise<void>,
  opts?: {
    onBeforeRun?: (index: number, completed: number) => void | Promise<void>;
    onError?: (err: unknown, index: number) => void | Promise<void>;
  },
): Promise<void> {
  if (total <= 0) return;
  const poolSize = Math.min(Math.max(1, concurrency), total);
  let cursor = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= total) return;

      if (opts?.onBeforeRun) {
        try {
          await opts.onBeforeRun(index, completed);
        } catch {
          // Instrumentation must never take down a worker.
        }
      }

      try {
        await runOne(index);
      } catch (err) {
        if (opts?.onError) {
          try {
            await opts.onError(err, index);
          } catch {
            // onError is a last-resort sink — if it also throws, swallow.
          }
        }
      }
      completed += 1;
    }
  }

  await Promise.all(Array.from({ length: poolSize }, () => worker()));
}

// ============================================================================
// Async task handler
// ============================================================================

async function executeSimulateAndRun(
  payload: SimulateAndRunPayload,
  updateProgress: (progress: {
    completed: number;
    total: number;
    currentTestCase: string | null;
  }) => void,
): Promise<void> {
  const { orgId, suiteId, suiteRunId, triggeredBy, testCaseIds, concurrency } =
    payload;
  const startTime = performance.now();

  try {
    await executeSimulateAndRunInner(
      orgId,
      suiteId,
      suiteRunId,
      triggeredBy,
      startTime,
      updateProgress,
      testCaseIds,
      concurrency,
    );
  } catch (err) {
    log.error({ err, suiteRunId, suiteId }, "simulate-and-run task failed");
    try {
      await forOrg(orgId, (tx) =>
        tx
          .update(evalSuiteRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            durationMs: elapsedMs(startTime),
          })
          .where(eq(evalSuiteRuns.id, suiteRunId)),
      );
    } catch (dbErr) {
      log.error(
        {
          err: dbErr,
          suiteRunId,
          originalError: err instanceof Error ? err.message : String(err),
        },
        "failed to mark suite run as failed in database",
      );
    }
  }
}

async function executeSimulateAndRunInner(
  orgId: string,
  suiteId: string,
  suiteRunId: string,
  triggeredBy: string | undefined,
  startTime: number,
  updateProgress: (progress: {
    completed: number;
    total: number;
    currentTestCase: string | null;
  }) => void,
  testCaseIds?: string[],
  concurrency?: number,
): Promise<void> {
  const suiteData = await forOrg(orgId, async (tx) => {
    const [suite] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    const [agent] = await tx
      .select({
        id: agents.id,
        name: agents.name,
        compiledInstructions: agents.compiledInstructions,
      })
      .from(agents)
      .where(eq(agents.id, suite!.agentId));

    let testCases = await tx
      .select()
      .from(evalSuiteTestCases)
      .where(eq(evalSuiteTestCases.suiteId, suiteId))
      .orderBy(asc(evalSuiteTestCases.order));

    // Filter to specific test cases if requested
    if (testCaseIds && testCaseIds.length > 0) {
      const requestedIds = new Set(testCaseIds);
      testCases = testCases.filter((tc) => requestedIds.has(tc.id));
    }

    return { suite: suite!, agent: agent!, testCases };
  });

  // If the suite is linked to a SOP, recompile for that SOP in dry-run mode
  // so multi-SOP agents always get the right compiled instructions.
  let compiledInstructions = suiteData.agent.compiledInstructions!;
  if (suiteData.suite.sopId) {
    try {
      const compiled = await compileAgent({
        orgId,
        agentId: suiteData.agent.id,
        sopIds: [suiteData.suite.sopId],
        dryRun: true,
      });
      compiledInstructions = compiled.ir.systemPrompt;
      log.info(
        { suiteId, sopId: suiteData.suite.sopId },
        "simulation: using SOP-specific compiled instructions (dry run)",
      );
    } catch (err) {
      log.warn(
        { suiteId, sopId: suiteData.suite.sopId, err },
        "simulation: SOP dry compile failed — falling back to agent's last compiled instructions",
      );
    }
  }

  // Defence in depth: also clamped at enqueue.
  const total = suiteData.testCases.length;
  const poolSize = resolveEvalConcurrency(concurrency);

  // Results are indexed by test-case order so the final ordering matches the
  // input (dashboards rely on stable order). Progress is a monotonic
  // "completed count" — with N cases in flight we can't meaningfully point at
  // a single "current" one, so `currentTestCase` stays null mid-run.
  const results: TestCaseEvalResult[] = new Array(total);

  async function runOne(index: number): Promise<void> {
    const testCase = suiteData.testCases[index];

    if (testCase.source === "recorded") {
      const recordedInput = testCase.input as RecordedTestCaseInput | null;
      const recordedSessionId = recordedInput?.sessionId;

      if (!recordedSessionId) {
        log.warn(
          { testCaseId: testCase.id },
          "recorded test case missing input.sessionId",
        );
        results[index] = erroredTestCaseResult(testCase);
        return;
      }

      try {
        results[index] = await runTestCaseEval(
          orgId,
          suiteData.suite,
          testCase,
          suiteRunId,
          recordedSessionId,
          { triggeredBy },
        );
      } catch (err) {
        log.warn(
          { err, testCaseId: testCase.id, suiteRunId },
          "recorded test case eval failed",
        );
        results[index] = await persistFailedEvalRun(
          orgId,
          suiteData.suite.id,
          suiteRunId,
          testCase,
          recordedSessionId,
          err instanceof Error ? err.message : "Unknown error",
        );
      }
      return;
    }

    const input = testCase.input as SimulationTestCaseInput;
    let inputMessage = input.message!; // validated in enqueueSimulateAndRun
    const personaId = input.persona;
    const conversationHistory = input.conversationHistory;
    const mockToolResponses =
      (testCase.mockToolResponses as Record<string, unknown>) ?? {};

    // 0. Resolve persona for personalization + multi-turn follow-ups
    const persona = personaId ? await getPersona(personaId, orgId) : undefined;
    if (personaId && !persona) {
      log.warn({ personaId }, "unknown persona ID — using raw message");
    }
    if (persona) {
      try {
        inputMessage = await personalizeInputMessage(inputMessage, persona);
        log.info(
          { testCaseId: testCase.id, persona: personaId },
          "personalized input message",
        );
      } catch (err) {
        log.warn(
          { err, personaId, testCaseId: testCase.id },
          "persona personalization failed — using raw message. Eval results may not reflect intended persona tone.",
        );
      }
    }

    // 1. Pre-create simulation session with mock config in metadata
    const userIdentifier = personaToIdentifier(personaId, persona);
    let adapter: MastraAdapter | null = null;
    let sessionId: string | null = null;
    try {
      const session = await createSession(orgId, suiteData.agent.id, {
        channelType: "api",
        userIdentifier,
        mode: "simulation",
        metadata: {
          source: "simulate-and-run",
          mockToolResponses,
        },
      });
      sessionId = session.id;

      // 2. Create MastraAdapter pointing at simulation MCP route
      const apiBaseUrl = env.API_EXTERNAL_ADDRESS;
      if (!apiBaseUrl) {
        throw Errors.validationError(
          "API_EXTERNAL_ADDRESS must be set for simulate-and-run (used to reach the simulation MCP route)",
        );
      }
      const simulationMcpUrl = `${apiBaseUrl}/simulations/${sessionId}/mcp`;
      const simulationToken = await generateSimulationJWT(sessionId);
      adapter = new MastraAdapter({
        compiledInstructions,
        model: env.SIMULATION_AGENT_MODEL,
        agentId: suiteData.agent.id,
        agentName: suiteData.agent.name,
        simulationMcpUrl,
        simulationToken,
        userIdentifier,
      });

      // 3. Run simulation — includes conversation history for replay tests
      const simResult = await runEvalSimulation({
        orgId,
        agentId: suiteData.agent.id,
        adapter,
        inputMessage,
        sessionId,
        conversationHistory,
        persona,
      });

      if (simResult.status === "error") {
        log.warn(
          { testCaseId: testCase.id, suiteRunId, error: simResult.error },
          "test case simulation failed",
        );
        results[index] = await persistFailedEvalRun(
          orgId,
          suiteData.suite.id,
          suiteRunId,
          testCase,
          sessionId,
          simResult.error,
        );
        return;
      }

      // 4. Score the session against test case evaluators
      results[index] = await runTestCaseEval(
        orgId,
        suiteData.suite,
        testCase,
        suiteRunId,
        simResult.sessionId,
        { triggeredBy },
      );
    } catch (err) {
      log.warn(
        { err, testCaseId: testCase.id, suiteRunId },
        "test case simulation+eval failed",
      );
      if (sessionId) {
        results[index] = await persistFailedEvalRun(
          orgId,
          suiteData.suite.id,
          suiteRunId,
          testCase,
          sessionId,
          err instanceof Error ? err.message : "Unknown error",
        );
      } else {
        log.error(
          { testCaseId: testCase.id, suiteRunId },
          "test case failed before session creation — result will not be persisted",
        );
        results[index] = erroredTestCaseResult(testCase);
      }
    } finally {
      await adapter?.disconnect();
    }
  }

  const effectivePoolSize = Math.min(poolSize, Math.max(1, total));
  log.info(
    { suiteRunId, suiteId, total, concurrency: effectivePoolSize },
    "simulate-and-run dispatching test cases with bounded concurrency",
  );

  await runBoundedPool(total, poolSize, runOne, {
    onBeforeRun: async (_index, completed) => {
      const progress = { completed, total, currentTestCase: null };
      updateProgress(progress);
      try {
        await forOrg(orgId, (tx) =>
          tx
            .update(evalSuiteRuns)
            .set({ metadata: { progress } })
            .where(eq(evalSuiteRuns.id, suiteRunId)),
        );
      } catch (err) {
        log.warn({ err, suiteRunId }, "progress update failed — continuing");
      }
    },
    // Defence in depth: runOne is designed never to throw, but if it ever
    // escapes (e.g., persistFailedEvalRun itself fails), capture the index as
    // errored so peer workers keep running and the suite run stays coherent.
    onError: (err, index) => {
      log.error(
        { err, suiteRunId, testCaseId: suiteData.testCases[index].id },
        "unexpected escape from runOne — storing errored result",
      );
      results[index] = erroredTestCaseResult(suiteData.testCases[index]);
    },
  });

  // Determine suite run status
  const durationMs = elapsedMs(startTime);
  const runStatus = determineSuiteRunStatus(results);

  await forOrg(orgId, (tx) =>
    tx
      .update(evalSuiteRuns)
      .set({
        status: runStatus,
        completedAt: new Date(),
        durationMs,
        metadata: {
          progress: {
            completed: suiteData.testCases.length,
            total: suiteData.testCases.length,
            currentTestCase: null,
          },
        },
      })
      .where(eq(evalSuiteRuns.id, suiteRunId)),
  );

  log.info(
    {
      suiteRunId,
      suiteId,
      runStatus,
      durationMs,
      testCaseCount: results.length,
    },
    "simulate-and-run completed",
  );
}

// ============================================================================
// Helpers
// ============================================================================

async function persistFailedEvalRun(
  orgId: string,
  suiteId: string,
  suiteRunId: string,
  testCase: { id: string; name: string },
  sessionId: string,
  error?: string,
): Promise<TestCaseEvalResult> {
  const [evalRun] = await forOrg(orgId, (tx) =>
    tx
      .insert(evalRuns)
      .values({
        organizationId: orgId,
        sessionId,
        sourceType: "suite",
        sourceId: suiteId,
        status: "error" as EvalStatus,
        passed: null,
        suiteRunId,
        testCaseId: testCase.id,
        metadata: error ? { error } : undefined,
        completedAt: new Date(),
      })
      .returning(),
  );

  return {
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    evalRunId: evalRun.id,
    passed: null,
    scores: [],
  };
}

function erroredTestCaseResult(testCase: {
  id: string;
  name: string;
}): TestCaseEvalResult {
  return {
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    evalRunId: null,
    passed: null,
    scores: [],
  };
}
