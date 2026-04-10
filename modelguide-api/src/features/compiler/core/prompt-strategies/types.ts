/**
 * PromptStrategy interface — all strategies implement this.
 *
 * A strategy takes the compiler's intermediate representation and produces
 * a model- and channel-optimized system prompt string.
 */

import type { CompilerWarning, TransformResult } from "../types";

/** Return type of PromptStrategy.buildPrompt(). */
export interface StrategyOutput {
  /** The compiled system prompt string. */
  prompt: string;
  /** Char offset where static content ends (before dynamic sections like Reminders). */
  cacheablePrefix: number;
  /** Strategy-specific warnings (e.g. TOOL_BLOCK_OVER_BUDGET). */
  warnings: CompilerWarning[];
}

export interface PromptStrategy {
  /** Human-readable name for logging/debugging. */
  readonly name: string;

  /** Build a system prompt from the transform result. */
  buildPrompt(ir: TransformResult): StrategyOutput;
}
