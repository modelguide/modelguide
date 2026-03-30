/**
 * Provider-agnostic model resolution for test case generation.
 *
 * Accepts model strings in "provider/model" format (e.g., "anthropic/claude-sonnet-4-20250514",
 * "openai/gpt-4o"). Bare model names (no slash) default to Anthropic for backwards compat.
 *
 * All providers are configured with GENERATION_LLM_API_KEY so a single env var
 * controls API access. When switching providers (e.g., from openai/* to anthropic/*),
 * the API key must also be changed to one valid for that provider.
 */

import { env } from "@/env";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { getLogger } from "@lib/logger";
import type { LanguageModel } from "ai";

const log = getLogger();

/** Lazily-created provider instances keyed by GENERATION_LLM_API_KEY. */
function getProviders(): Record<string, (model: string) => LanguageModel> {
  const apiKey = env.GENERATION_LLM_API_KEY;
  return {
    anthropic: (model) => createAnthropic({ apiKey })(model),
    openai: (model) => createOpenAI({ apiKey })(model),
  };
}

/**
 * Resolve a "provider/model" string into a Vercel AI SDK LanguageModel.
 * Bare model names (no slash) default to Anthropic.
 *
 * Uses GENERATION_LLM_API_KEY for all providers.
 */
export function resolveGenerationModel(modelId: string): LanguageModel {
  const providers = getProviders();
  const slashIdx = modelId.indexOf("/");

  if (slashIdx === -1) {
    return providers.anthropic(modelId);
  }

  const provider = modelId.slice(0, slashIdx);
  const model = modelId.slice(slashIdx + 1);

  const factory = providers[provider];
  if (!factory) {
    throw new Error(
      `Unknown generation model provider "${provider}". Supported: ${Object.keys(providers).join(", ")}`,
    );
  }

  return factory(model);
}

/** Per-MTok pricing: [inputCostPerMTok, outputCostPerMTok]. As of March 2026. */
const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-sonnet-4-20250514": [3, 15],
  "claude-haiku-4-5-20251001": [0.8, 4],
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "o4-mini": [1.1, 4.4],
};

/**
 * Estimate cost in USD for a given model and token usage.
 * Returns 0 if the model is not in the pricing map.
 */
export function estimateModelCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = modelId.includes("/") ? modelId.split("/")[1] : modelId;
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    log.warn(
      { model, modelId },
      "no pricing data for model — cost estimate will be $0",
    );
    return 0;
  }
  const [inputRate, outputRate] = pricing;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}
