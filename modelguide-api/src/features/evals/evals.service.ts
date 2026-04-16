/**
 * Eval service — shared scoring engine and query functions for evaluation runs.
 */

import { forOrg } from "@db/rls";
import { type SessionMessage, evalRunScores, evalRuns, sops } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, desc, eq } from "drizzle-orm";

import { parseStepEvaluatorConfig } from "../eval-configs/eval-configs.schemas";
import type { EvalScoreResult, ResolvedAssertion } from "./evals.types";
import { getEvaluator } from "./evaluators";
import type {
  EvalContext,
  EvalSessionContext,
  EvaluatorResult,
} from "./evaluators/evaluator.types";

type ScoreInsert = typeof evalRunScores.$inferInsert;

// ============================================================================
// Evaluator execution
// ============================================================================

/**
 * Execute evaluators for all assertions concurrently, returning score rows.
 *
 * All assertions are always evaluated — no short-circuit on required assertion failure.
 * This gives forensic visibility into what else went wrong, which is critical
 * for debugging and improving SOPs.
 *
 * Concurrency is capped at EVAL_CONCURRENCY to avoid flooding the LLM API
 * with too many simultaneous judge calls.
 */
const EVAL_CONCURRENCY = 5;

export async function executeAssertions(
  assertions: ResolvedAssertion[],
  messages: SessionMessage[],
  evalRunId: string,
  orgId: string,
  sessionContext?: EvalSessionContext,
): Promise<{ scoreRows: ScoreInsert[]; metadata: Record<string, unknown> }> {
  const toolMsgs = messages.filter((m) => m.role === "tool");

  async function runOne(assertion: ResolvedAssertion): Promise<ScoreInsert> {
    const resolvedToolNames = new Map(Object.entries(assertion.toolNameMap));
    const ctx: EvalContext = {
      messages,
      toolMessages: toolMsgs,
      resolvedToolNames,
      sessionContext,
    };

    const parsedConfig = parseStepEvaluatorConfig(
      assertion.evaluator.evaluatorType,
      assertion.evaluator.config,
    );
    if (!parsedConfig.success) {
      const details = parsedConfig.issues.map((i) => i.message).join("; ");
      return {
        evalRunId,
        organizationId: orgId,
        evalConfigId: assertion.evaluator.configId,
        name: assertion.name,
        scoreOrder: assertion.order,
        required: assertion.required,
        evaluatorType: assertion.evaluator.evaluatorType,
        result: "error" as EvalScoreResult,
        reasoning: `Invalid eval config: ${details}`,
      };
    }

    const evaluator = getEvaluator(assertion.evaluator.evaluatorType);

    let evalResult: EvaluatorResult;
    try {
      evalResult = await evaluator.evaluate(ctx, parsedConfig.config);
    } catch (err) {
      evalResult = {
        result: "error",
        reasoning: `Evaluator threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return {
      evalRunId,
      organizationId: orgId,
      evalConfigId: assertion.evaluator.configId,
      name: assertion.name,
      scoreOrder: assertion.order,
      required: assertion.required,
      evaluatorType: assertion.evaluator.evaluatorType,
      result: evalResult.result as EvalScoreResult,
      reasoning: evalResult.reasoning,
      failureClassification: evalResult.failureClassification ?? null,
      expected: evalResult.expected ?? null,
      actual: evalResult.actual ?? null,
      durationMs: evalResult.durationMs ?? null,
    };
  }

  // Run up to EVAL_CONCURRENCY evaluators at a time.
  const scoreRows: ScoreInsert[] = [];
  for (let i = 0; i < assertions.length; i += EVAL_CONCURRENCY) {
    const batch = assertions.slice(i, i + EVAL_CONCURRENCY);
    const results = await Promise.all(batch.map(runOne));
    scoreRows.push(...results);
  }

  const scoreRows = await Promise.all(assertions.map(runOne));

  const metadata: Record<string, unknown> = {};
  return { scoreRows, metadata };
}

// ============================================================================
// Queries
// ============================================================================

/** List eval runs with optional filters and pagination. */
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
      conditions.push(
        eq(evalRuns.sourceType, sourceType as "suite" | "replay_test" | "live"),
      );
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

/** Get a single eval run by ID, including scores and source name. */
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

    // Resolve source name for non-suite source types (e.g. replay_test, live)
    let sourceName: string | null = null;
    if (run.sourceType !== "suite") {
      const [sopRow] = await tx
        .select({ name: sops.name })
        .from(sops)
        .where(eq(sops.id, run.sourceId));
      sourceName = sopRow?.name ?? null;
    }

    return { ...run, scores, sourceName };
  });
}
