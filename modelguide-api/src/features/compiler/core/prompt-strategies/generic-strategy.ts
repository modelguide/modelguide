/**
 * GenericStrategy — backward-compatible prompt format.
 *
 * Wraps the existing buildSystemPrompt() to produce the same markdown output
 * as Phase 1. Used as fallback for all (modelFamily, channel) combinations
 * that don't have a dedicated strategy.
 */

import { buildSystemPrompt } from "../prompt-builder";
import type { CompilerIR } from "../types";
import type { PromptStrategy, StrategyOutput } from "./types";

export class GenericStrategy implements PromptStrategy {
  readonly name = "GenericStrategy";

  buildPrompt(ir: CompilerIR): StrategyOutput {
    const prompt = buildSystemPrompt(
      ir.agentConfig.description,
      {
        name: ir.sop.name,
        description: ir.sop.description,
        definition: ir.sop.definition,
      },
      ir.guardrails,
      ir.tools,
    );

    // Generic strategy: entire prompt is static (no [Reminders] section)
    return { prompt, cacheablePrefix: prompt.length, warnings: [] };
  }
}
