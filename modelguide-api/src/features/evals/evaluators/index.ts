/**
 * Evaluator registry — maps evaluator type strings to implementations.
 */

import type { Evaluator } from "./evaluator.types";
import { llmJudgeEvaluator } from "./llm-judge";
import { noToolCalledEvaluator } from "./no-tool-called";
import { toolCalledEvaluator } from "./tool-called";
import { toolInputEvaluator } from "./tool-input";

const evaluators: ReadonlyMap<string, Evaluator> = new Map([
  ["tool_called", toolCalledEvaluator],
  ["tool_input_contains", toolInputEvaluator],
  ["no_tool_called", noToolCalledEvaluator],
  ["llm_judge", llmJudgeEvaluator],
]);

export function getEvaluator(type: string): Evaluator {
  const evaluator = evaluators.get(type);
  if (!evaluator) {
    throw new Error(`Unknown evaluator type: "${type}"`);
  }
  return evaluator;
}
