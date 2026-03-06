/**
 * tool_called evaluator — verifies a specific tool was called during the session.
 */

import { elapsedMs } from "../evals.time";
import type { StepEvaluatorConfig } from "../evals.types";
import type {
  EvalContext,
  Evaluator,
  EvaluatorResult,
} from "./evaluator.types";

export const toolCalledEvaluator: Evaluator = {
  type: "tool_called",

  async evaluate(
    ctx: EvalContext,
    config: StepEvaluatorConfig,
  ): Promise<EvaluatorResult> {
    if (config.type !== "tool_called") {
      return {
        result: "error",
        reasoning: `Invalid config type "${config.type}" for tool_called evaluator`,
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

    // Skip if no tool messages exist at all (verbal resolution)
    if (ctx.toolMessages.length === 0) {
      return {
        result: "skip",
        reasoning:
          "No tool calls in session — agent may have resolved without tools",
        expected: { toolName: resolvedName },
        actual: { toolCallCount: 0 },
        durationMs: elapsedMs(start),
      };
    }

    const found = ctx.toolMessages.some((msg) => msg.toolName === resolvedName);

    if (found) {
      return {
        result: "pass",
        reasoning: `Tool "${resolvedName}" was called during the session`,
        expected: { toolName: resolvedName },
        actual: { toolName: resolvedName },
        durationMs: elapsedMs(start),
      };
    }

    const calledTools = [
      ...new Set(
        ctx.toolMessages
          .map((m) => m.toolName)
          .filter((n): n is string => n !== null),
      ),
    ];

    return {
      result: "fail",
      reasoning: `Tool "${resolvedName}" was not called. Tools called: ${calledTools.length > 0 ? calledTools.join(", ") : "none"}`,
      failureClassification: "tool_not_called",
      expected: { toolName: resolvedName },
      actual: { calledTools },
      durationMs: elapsedMs(start),
    };
  },
};
