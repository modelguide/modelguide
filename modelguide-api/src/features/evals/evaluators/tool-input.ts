/**
 * tool_input_contains evaluator — verifies a tool was called with expected input fields.
 */

import { elapsedMs } from "../evals.time";
import type { Assertion, StepEvaluatorConfig } from "../evals.types";
import { runAssertion } from "./assertions";
import type {
  EvalContext,
  Evaluator,
  EvaluatorResult,
} from "./evaluator.types";

export const toolInputEvaluator: Evaluator = {
  type: "tool_input_contains",

  async evaluate(
    ctx: EvalContext,
    config: StepEvaluatorConfig,
  ): Promise<EvaluatorResult> {
    if (config.type !== "tool_input_contains") {
      return {
        result: "error",
        reasoning: `Invalid config type "${config.type}" for tool_input_contains evaluator`,
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

    // Find the tool call
    const toolMsg = ctx.toolMessages.find(
      (msg) => msg.toolName === resolvedName,
    );

    if (!toolMsg) {
      const calledTools = [
        ...new Set(
          ctx.toolMessages
            .map((m) => m.toolName)
            .filter((n): n is string => n !== null),
        ),
      ];

      return {
        result: "fail",
        reasoning: `Tool "${resolvedName}" was not called — cannot check input assertions. Tools called: ${calledTools.length > 0 ? calledTools.join(", ") : "none"}`,
        failureClassification: "tool_not_called",
        expected: { toolName: resolvedName },
        actual: { calledTools },
        durationMs: elapsedMs(start),
      };
    }

    // Run assertions against tool input
    const toolInput = (toolMsg.toolInput ?? {}) as Record<string, unknown>;
    const assertions = config.assertions as Record<string, Assertion>;
    const failures: string[] = [];
    const errors: string[] = [];
    const expectedFields: Record<string, unknown> = {};
    const actualFields: Record<string, unknown> = {};

    for (const [field, assertion] of Object.entries(assertions)) {
      const result = runAssertion(field, assertion, toolInput[field]);
      expectedFields[field] = result.expected;
      actualFields[field] = result.actual;

      if (result.errored) {
        errors.push(result.message);
      } else if (!result.passed) {
        failures.push(result.message);
      }
    }

    // Config errors (bad regex, etc.) → error, not fail
    if (errors.length > 0) {
      return {
        result: "error",
        reasoning: `Assertion config error on tool "${resolvedName}": ${errors.join("; ")}`,
        expected: expectedFields,
        actual: actualFields,
        durationMs: elapsedMs(start),
      };
    }

    if (failures.length === 0) {
      return {
        result: "pass",
        reasoning: `Tool "${resolvedName}" was called with all expected input fields: ${Object.keys(assertions).join(", ")}`,
        expected: expectedFields,
        actual: actualFields,
        durationMs: elapsedMs(start),
      };
    }

    return {
      result: "fail",
      reasoning: `Tool "${resolvedName}" input assertion failures: ${failures.join("; ")}`,
      failureClassification: "wrong_arguments",
      expected: expectedFields,
      actual: actualFields,
      durationMs: elapsedMs(start),
    };
  },
};
