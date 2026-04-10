/**
 * Strategy selection — picks the right PromptStrategy for (modelFamily, channel).
 */

import { getLogger } from "@lib/logger";
import type { Channel, ModelFamily } from "../types";
import { GenericStrategy } from "./generic-strategy";
import { GptVoiceStrategy } from "./gpt-voice-strategy";
import type { PromptStrategy } from "./types";

export type { PromptStrategy, StrategyOutput } from "./types";
export { GenericStrategy } from "./generic-strategy";
export { GptVoiceStrategy } from "./gpt-voice-strategy";

/**
 * Select a prompt strategy based on model family and channel.
 *
 * For v1: only (gpt, voice) → GptVoiceStrategy.
 * All other combinations fall back to GenericStrategy.
 */
export function getStrategy(
  modelFamily: ModelFamily,
  channel: Channel,
): PromptStrategy {
  if (modelFamily === "gpt" && channel === "voice") {
    return new GptVoiceStrategy();
  }

  getLogger().warn(
    { modelFamily, channel },
    `no dedicated prompt strategy for (${modelFamily}, ${channel}) — falling back to GenericStrategy`,
  );
  return new GenericStrategy();
}
