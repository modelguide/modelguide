/**
 * no_tool_called evaluator — verifies a specific tool was NOT called (guardrail-style).
 */

import { elapsedMs } from "../evals.time";
import type { StepEvaluatorConfig } from "../evals.types";
import type {
  EvalContext,
  Evaluator,
  EvaluatorResult,
} from "./evaluator.types";

export const noToolCalledEvaluator: Evaluator = {
  type: "no_tool_called",

  async evaluate(
    ctx: EvalContext,
    config: StepEvaluatorConfig,
  ): Promise<EvaluatorResult> {
    if (config.type !== "no_tool_called") {
      return {
        result: "error",
        reasoning: `Invalid config type "${config.type}" for no_tool_called evaluator`,
      };
    }

    const start = performance.now();
    const resolvedName = ctx.resolvedToolNames.get(config.connectorToolId);

    if (!resolvedName) {
      return {
        result: "error",
        reasoning: `Could not resolve connector tool ID "${config.connectorToolId}" to a runtime tool name`,
        durationMs: elapsedMs(start),
      };
    }

    const found = ctx.toolMessages.some((msg) => msg.toolName === resolvedName);

    if (!found) {
      return {
        result: "pass",
        reasoning: `Tool "${resolvedName}" was correctly not called during the session`,
        expected: { toolNotCalled: resolvedName },
        actual: { toolNotCalled: true },
        durationMs: elapsedMs(start),
      };
    }

    return {
      result: "fail",
      reasoning: `Tool "${resolvedName}" was called but should not have been (policy violation)`,
      failureClassification: "policy_violation",
      expected: { toolNotCalled: resolvedName },
      actual: { toolNotCalled: false, toolName: resolvedName },
      durationMs: elapsedMs(start),
    };
  },
};
