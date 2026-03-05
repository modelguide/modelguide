/**
 * Eval service — runner, list, and get queries for evaluation runs.
 */

import { forOrg } from "@db/rls";
import {
  evalRunScores,
  evalRuns,
  sessionMessages,
  sessions,
  sops,
} from "@db/schema";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, desc, eq } from "drizzle-orm";

import { compileSopToEvalPlan } from "./evals.compile";
import type {
  EvalScoreResult,
  EvalSourceType,
  EvalStatus,
  StepEvaluatorConfig,
} from "./evals.types";
import { getEvaluator } from "./evaluators";
import type { EvalContext } from "./evaluators/evaluator.types";
import { getReporter } from "./reporters";
import type { EvalRunReport } from "./reporters/reporter.types";

const log = getLogger();

// ============================================================================
// Helpers
// ============================================================================

/** Truncate instruction to N chars for score name. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

/** Build human-readable score name: step:{order}:{instruction_truncated} */
function buildScoreName(order: number, instruction: string): string {
  return `step:${order}:${truncate(instruction, 60)}`;
}

const TERMINAL_STATUSES = new Set(["completed", "abandoned"]);

// ============================================================================
// Runner
// ============================================================================

export async function runEvaluation(
  orgId: string,
  sessionId: string,
  sourceType: EvalSourceType,
  sourceId: string,
  options?: { reporter?: string; triggeredBy?: string },
) {
  // 1. Validate sourceType
  if (sourceType !== "sop") {
    throw Errors.validationError(`Unsupported source type: "${sourceType}"`);
  }

  const startTime = performance.now();

  // 2. Validate session + create eval_runs row (short transaction)
  const evalRun = await forOrg(orgId, async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) {
      throw Errors.sessionNotFound(sessionId);
    }

    if (!TERMINAL_STATUSES.has(session.status)) {
      throw Errors.evalSessionNotTerminal(sessionId, session.status);
    }

    try {
      const [row] = await tx
        .insert(evalRuns)
        .values({
          organizationId: orgId,
          sessionId,
          sourceType: sourceType as "sop",
          sourceId,
          status: "running",
          triggeredBy: options?.triggeredBy,
        })
        .returning();
      return row;
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("eval_runs_active_unique")
      ) {
        throw Errors.evalAlreadyRunning(sessionId, sourceId);
      }
      throw err;
    }
  });

  let metadata: Record<string, unknown> = {};

  try {
    // 3. Compile eval plan (outside long-lived DB transaction)
    const plan = await compileSopToEvalPlan(orgId, sourceId, sessionId);

    // 4. Load transcript messages (short transaction)
    const messages = await forOrg(orgId, (tx) =>
      tx
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, sessionId))
        .orderBy(
          asc(sessionMessages.occurredAt),
          asc(sessionMessages.createdAt),
        ),
    );

    const toolMsgs = messages.filter((m) => m.role === "tool");

    // 5. Execute evaluators (no DB transaction held)
    const scoreRows: Array<typeof evalRunScores.$inferInsert> = [];
    let shortCircuited = false;
    let shortCircuitReason = "";

    for (const step of plan.steps) {
      const scoreName = buildScoreName(step.order, step.instruction);

      // No eval config → skip (no score row, tracked in coverage warnings)
      if (!step.evaluator) {
        continue;
      }

      if (shortCircuited) {
        scoreRows.push({
          evalRunId: evalRun.id,
          organizationId: orgId,
          evalConfigId: step.evaluator.configId,
          name: scoreName,
          scoreOrder: step.order,
          required: step.required,
          evaluatorType: step.evaluator.evaluatorType,
          result: "skip",
          reasoning: shortCircuitReason,
        });
        continue;
      }

      const resolvedToolNames = new Map(Object.entries(step.toolNameMap));
      const ctx: EvalContext = {
        messages,
        toolMessages: toolMsgs,
        resolvedToolNames,
      };

      const evaluator = getEvaluator(step.evaluator.evaluatorType);
      const evalConfig: StepEvaluatorConfig = {
        type: step.evaluator.evaluatorType,
        ...step.evaluator.config,
      } as StepEvaluatorConfig;

      const evalResult = await evaluator.evaluate(ctx, evalConfig);

      scoreRows.push({
        evalRunId: evalRun.id,
        organizationId: orgId,
        evalConfigId: step.evaluator.configId,
        name: scoreName,
        scoreOrder: step.order,
        required: step.required,
        evaluatorType: step.evaluator.evaluatorType,
        result: evalResult.result as EvalScoreResult,
        reasoning: evalResult.reasoning,
        failureClassification: evalResult.failureClassification ?? null,
        expected: evalResult.expected ?? null,
        actual: evalResult.actual ?? null,
        durationMs: evalResult.durationMs ?? null,
      });

      if (
        step.required &&
        (evalResult.result === "fail" || evalResult.result === "error")
      ) {
        shortCircuited = true;
        const verb = evalResult.result === "fail" ? "failed" : "errored";
        shortCircuitReason = `Skipped: required step "${step.stepId}" ${verb}`;
      }
    }

    const failedOrErroredRequired = scoreRows.filter(
      (s) => s.required && (s.result === "fail" || s.result === "error"),
    );
    const passed = failedOrErroredRequired.length === 0;

    const stepsWithoutConfig = plan.steps.filter((s) => !s.evaluator);
    metadata = {};
    if (stepsWithoutConfig.length > 0) {
      metadata.coverageWarning = `${stepsWithoutConfig.length} of ${plan.steps.length} steps have no eval config assigned`;
      metadata.uncoveredSteps = stepsWithoutConfig.map((s) => s.stepId);
    }

    const durationMs = Math.round(performance.now() - startTime);

    // 6. Persist scores + final run state (short transaction)
    const { updatedRun, scores, sourceName } = await forOrg(
      orgId,
      async (tx) => {
        if (scoreRows.length > 0) {
          await tx.insert(evalRunScores).values(scoreRows);
        }

        const [completedRun] = await tx
          .update(evalRuns)
          .set({
            status: "completed" as EvalStatus,
            passed,
            durationMs,
            metadata: Object.keys(metadata).length > 0 ? metadata : null,
            completedAt: new Date(),
          })
          .where(eq(evalRuns.id, evalRun.id))
          .returning();

        const persistedScores = await tx
          .select()
          .from(evalRunScores)
          .where(eq(evalRunScores.evalRunId, evalRun.id))
          .orderBy(asc(evalRunScores.scoreOrder));

        const [sopRow] = await tx
          .select({ name: sops.name })
          .from(sops)
          .where(eq(sops.id, sourceId));

        return {
          updatedRun: completedRun,
          scores: persistedScores,
          sourceName: sopRow?.name ?? sourceId,
        };
      },
    );

    // 7. Fire reporter (non-blocking)
    try {
      const reporter = getReporter(options?.reporter);

      const report: EvalRunReport = {
        runId: updatedRun.id,
        sessionId,
        sourceType,
        sourceId,
        sourceName,
        passed,
        scores: scores.map((s) => ({
          name: s.name,
          evalConfigId: s.evalConfigId ?? "",
          evaluatorType: s.evaluatorType,
          result: s.result as "pass" | "fail" | "skip" | "error",
          reasoning: s.reasoning,
          failureClassification: s.failureClassification ?? undefined,
          expected: (s.expected as Record<string, unknown> | null) ?? undefined,
          actual: (s.actual as Record<string, unknown> | null) ?? undefined,
        })),
        metadata,
      };

      reporter
        .report(report)
        .then((result) => {
          if (result.externalRunId || result.externalRunUrl) {
            forOrg(orgId, (innerTx) =>
              innerTx
                .update(evalRuns)
                .set({
                  externalRunId: result.externalRunId,
                  externalRunUrl: result.externalRunUrl,
                })
                .where(eq(evalRuns.id, evalRun.id)),
            ).catch((err) => {
              log.warn(
                { err, evalRunId: evalRun.id },
                "failed to update external run references",
              );
            });
          }
        })
        .catch((err) => {
          log.warn(
            { err, reporter: options?.reporter, evalRunId: evalRun.id },
            "eval reporter failed (results saved locally)",
          );
        });
    } catch (err) {
      log.warn(
        { err, reporter: options?.reporter },
        "failed to initialize eval reporter",
      );
    }

    return { ...updatedRun, scores };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    const message =
      err instanceof Error ? err.message : "Unknown evaluation error";

    await forOrg(orgId, (tx) =>
      tx
        .update(evalRuns)
        .set({
          status: "failed" as EvalStatus,
          passed: null,
          durationMs,
          metadata: { error: message },
          completedAt: new Date(),
        })
        .where(eq(evalRuns.id, evalRun.id)),
    );

    throw err;
  }
}

// ============================================================================
// Queries
// ============================================================================

export async function listEvalRuns(
  orgId: string,
  params: {
    sessionId?: string;
    sourceType?: string;
    sourceId?: string;
    status?: string;
  } & PaginationParams,
) {
  const { page, pageSize, sessionId, sourceType, sourceId, status } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (sessionId) conditions.push(eq(evalRuns.sessionId, sessionId));
    if (sourceType)
      conditions.push(eq(evalRuns.sourceType, sourceType as "sop"));
    if (sourceId) conditions.push(eq(evalRuns.sourceId, sourceId));
    if (status)
      conditions.push(
        eq(
          evalRuns.status,
          status as "pending" | "running" | "completed" | "failed",
        ),
      );

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(evalRuns)
        .where(where)
        .orderBy(desc(evalRuns.createdAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(evalRuns).where(where),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getEvalRunById(orgId: string, runId: string) {
  return forOrg(orgId, async (tx) => {
    const [run] = await tx
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.id, runId));

    if (!run) {
      throw Errors.evalRunNotFound(runId);
    }

    const scores = await tx
      .select()
      .from(evalRunScores)
      .where(eq(evalRunScores.evalRunId, runId))
      .orderBy(asc(evalRunScores.scoreOrder));

    // Load source name
    let sourceName: string | null = null;
    if (run.sourceType === "sop") {
      const [sopRow] = await tx
        .select({ name: sops.name })
        .from(sops)
        .where(eq(sops.id, run.sourceId));
      sourceName = sopRow?.name ?? null;
    }

    return { ...run, scores, sourceName };
  });
}
