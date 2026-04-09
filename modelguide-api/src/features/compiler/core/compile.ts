/**
 * compile() — top-level orchestrator for the core pipeline.
 *
 * parse → transform → strategy → metadata → CompilerIR
 */

import { parse } from "./parse";
import { getStrategy } from "./prompt-strategies";
import { transform } from "./transform";
import type {
  CompilerIR,
  CompilerInput,
  CompilerMetadata,
  CompilerWarning,
} from "./types";

/** Voice channel token budget threshold. */
const VOICE_TOKEN_BUDGET = 2500;
/** Text channel token budget threshold. */
const TEXT_TOKEN_BUDGET = 8000;
/** Average tokens per tool schema (MCP tools/list overhead). */
const TOKENS_PER_TOOL_SCHEMA = 180;

/**
 * Compile a single SOP + guardrails into a CompilerIR.
 *
 * @throws CompilerError on validation failures
 */
export function compile(input: CompilerInput): CompilerIR {
  const { sop, tools: parsedTools, guardrails } = parse(input);

  // Enrich tools with requiresConfirmation from the input map (AC6)
  const confirmMap = input.toolConfirmationMap ?? {};
  const tools = parsedTools.map((t) => ({
    ...t,
    requiresConfirmation: confirmMap[t.resolvedName] ?? t.requiresConfirmation,
  }));

  const ir = transform(
    sop,
    tools,
    guardrails,
    input.agentConfig,
    input.agentSops,
  );

  // Select strategy based on model family + channel
  const { modelFamily, channel } = input.agentConfig;
  const strategy = getStrategy(modelFamily, channel);

  // Build prompt via strategy
  const {
    prompt,
    cacheablePrefix,
    warnings: strategyWarnings,
  } = strategy.buildPrompt(ir);

  // Compute metadata (AC22, AC23)
  const systemPromptTokens = Math.ceil(prompt.length / 4);
  const estimatedToolSchemaTokens = tools.length * TOKENS_PER_TOOL_SCHEMA;
  const totalEstimatedTokens = systemPromptTokens + estimatedToolSchemaTokens;

  const warnings: CompilerWarning[] = [...strategyWarnings];

  // AC23: warn when budget exceeded
  const budget = channel === "voice" ? VOICE_TOKEN_BUDGET : TEXT_TOKEN_BUDGET;
  if (totalEstimatedTokens > budget) {
    const code =
      channel === "voice" ? "VOICE_BUDGET_EXCEEDED" : "TEXT_BUDGET_EXCEEDED";
    warnings.push({
      code,
      message: `Estimated ${totalEstimatedTokens} tokens exceeds ${channel} budget of ${budget}`,
      tokens: totalEstimatedTokens,
    });
  }

  const metadata: CompilerMetadata = {
    systemPromptTokens,
    estimatedToolSchemaTokens,
    totalEstimatedTokens,
    cacheablePrefix,
    warnings,
  };

  return {
    ...ir,
    systemPrompt: prompt,
    metadata,
  };
}
