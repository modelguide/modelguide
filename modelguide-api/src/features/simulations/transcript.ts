import type { CoreMessage } from "@mastra/core/llm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Stored/session-facing history shape.
 *
 * In app transcripts, `user` means the customer and `assistant` means the
 * support agent. These labels are correct for storage, but they are *not*
 * the same thing as "what the currently active model said". The helpers below
 * project this neutral stored history into the POV each model needs.
 */
export interface SimulationHistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/**
 * Explicit domain speaker labels used only inside the simulation layer.
 * This keeps the intent readable before we project into provider-specific
 * chat roles like `user` / `assistant`.
 */
export interface SimulationTranscriptTurn {
  speaker: "customer" | "agent" | "system" | "tool";
  content: string;
}

export function toTranscriptTurns(
  messages: SimulationHistoryMessage[],
): SimulationTranscriptTurn[] {
  return messages.map((message) => ({
    speaker: historyRoleToSpeaker(message.role),
    content: message.content,
  }));
}

/**
 * Convert stored transcript history into the persona model's point of view.
 *
 * For the persona LLM, `assistant` means "what I, the customer, already said"
 * and `user` means "what the agent just said to me".
 */
export function toPersonaLlmHistory(
  messages: SimulationHistoryMessage[],
): ChatCompletionMessageParam[] {
  const projected: ChatCompletionMessageParam[] = [];

  for (const turn of toTranscriptTurns(messages)) {
    switch (turn.speaker) {
      case "customer":
        projected.push({ role: "assistant", content: turn.content });
        break;
      case "agent":
        projected.push({ role: "user", content: turn.content });
        break;
      case "system":
        projected.push({ role: "system", content: turn.content });
        break;
      case "tool":
        // Tool rows are internal execution details, not spoken dialogue.
        break;
    }
  }

  return projected;
}

/**
 * Convert stored transcript history into the agent model's point of view.
 *
 * For the agent LLM, `user` remains the customer and `assistant` remains the
 * agent. System messages are preserved. Tool rows are omitted here because
 * replay fixtures only carry plain text content, not the structured tool-result
 * objects that provider tool messages require.
 */
export function toAgentCoreHistory(
  messages: SimulationHistoryMessage[],
): CoreMessage[] {
  const projected: CoreMessage[] = [];

  for (const turn of toTranscriptTurns(messages)) {
    switch (turn.speaker) {
      case "customer":
        projected.push({ role: "user", content: turn.content });
        break;
      case "agent":
        projected.push({ role: "assistant", content: turn.content });
        break;
      case "system":
        projected.push({ role: "system", content: turn.content });
        break;
      case "tool":
        break;
    }
  }

  return projected;
}

function historyRoleToSpeaker(
  role: SimulationHistoryMessage["role"],
): SimulationTranscriptTurn["speaker"] {
  switch (role) {
    case "user":
      return "customer";
    case "assistant":
      return "agent";
    case "system":
      return "system";
    case "tool":
      return "tool";
  }
}
