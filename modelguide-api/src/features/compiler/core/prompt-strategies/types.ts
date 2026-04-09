/**
 * PromptStrategy interface — all strategies implement this.
 *
 * A strategy takes the compiler's intermediate representation and produces
 * a model- and channel-optimized system prompt string.
 */

import type { CompilerIR, CompilerWarning } from "../types";

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

  /** Build a system prompt string from the compiler IR. */
  buildPrompt(ir: CompilerIR): StrategyOutput;
}
