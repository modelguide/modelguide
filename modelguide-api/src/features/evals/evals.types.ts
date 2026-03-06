/**
 * Core types for the evaluation engine.
 *
 * Storage layout:
 *  - eval_configs: evaluator_type column + config JSONB (type-specific params only)
 *  - eval_runs:    one row per evaluation of a session against a source
 *  - eval_run_scores: one row per score in an evaluation run
 */

// ============================================================================
// Evaluator config — discriminated union
// ============================================================================

export type AssertionOp =
  | "equals"
  | "contains"
  | "gt"
  | "lt"
  | "exists"
  | "matches";

export interface Assertion {
  op: AssertionOp;
  value?: string | number | boolean;
}

export type StepEvaluatorConfig =
  | { type: "tool_called"; connectorToolId: string }
  | {
      type: "tool_input_contains";
      connectorToolId: string;
      assertions: Record<string, Assertion>;
    }
  | { type: "no_tool_called"; connectorToolId: string }
  | {
      type: "llm_judge";
      criterion: string;
      rubric?: { pass: string; fail: string };
      model?: string;
      skipOnFailure?: boolean;
    };

export type EvaluatorType = StepEvaluatorConfig["type"];

// ============================================================================
// Failure classification
// ============================================================================

export type FailureClassification =
  | "tool_not_called"
  | "wrong_arguments"
  | "policy_violation"
  | "criterion_not_met";

// ============================================================================
// Eval plan — output of compilation
// ============================================================================

export interface ResolvedEvaluator {
  configId: string;
  evaluatorType: EvaluatorType;
  config: Record<string, unknown>;
}

export interface EvalPlanStep {
  stepId: string;
  order: number;
  instruction: string;
  required: boolean;
  evaluator: ResolvedEvaluator | null;
  toolNameMap: Record<string, string>;
}

export interface EvalPlan {
  sessionId: string;
  sopId: string;
  steps: EvalPlanStep[];
}

// ============================================================================
// Eval source types (extensible for guardrails, FAQ, etc.)
// ============================================================================

export type EvalSourceType = "sop";
export type EvalStatus = "pending" | "running" | "completed" | "failed";
export type EvalScoreResult = "pass" | "fail" | "skip" | "error";
