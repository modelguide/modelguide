/**
 * Evaluator interface and context types.
 *
 * All evaluators are pure functions: (EvalContext, config) → EvaluatorResult.
 * No side effects, no network calls (except llm_judge).
 */

import type { SessionMessage } from "@db/schema";
import type {
  EvalScoreResult,
  FailureClassification,
  StepEvaluatorConfig,
} from "../evals.types";

// ============================================================================
// EvalContext — what evaluators see
// ============================================================================

export interface EvalContext {
  /** All session messages in chronological order. */
  messages: SessionMessage[];
  /** Only role="tool" messages. */
  toolMessages: SessionMessage[];
  /** connectorToolId → resolved runtime tool name ({connectorSlug}_{toolSlug}). */
  resolvedToolNames: Map<string, string>;
}

// ============================================================================
// EvaluatorResult — what evaluators return
// ============================================================================

export interface EvaluatorResult {
  result: EvalScoreResult;
  /** Mandatory, substantive reasoning for the score. */
  reasoning: string;
  failureClassification?: FailureClassification;
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
  durationMs?: number;
}

// ============================================================================
// Evaluator interface
// ============================================================================

export interface Evaluator {
  readonly type: string;
  evaluate(
    ctx: EvalContext,
    config: StepEvaluatorConfig,
  ): Promise<EvaluatorResult>;
}
