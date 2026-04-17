/**
 * Thin OpenAI SDK wrapper for persona simulation.
 * Handles both persona (user-simulator) and agent (tool-calling) LLM calls.
 *
 * Supports any OpenAI-compatible endpoint including Anthropic's compatibility
 * layer (https://api.anthropic.com/v1/). Note: Anthropic ignores the `strict`
 * parameter for function calling, so tool call arguments may not conform to the
 * schema. All JSON.parse calls are wrapped in try/catch to handle this gracefully.
 */

import { env } from "@/env";
import type { ResolvedTool } from "@features/mcp/mcp.types";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

const SIMULATION_MAX_TOKENS = 16_000;
const logger = getLogger();

/**
 * How many consecutive prose fallbacks from the persona LLM we tolerate before
 * force-stopping the simulation. Without the `done` signal we'd otherwise burn
 * the whole max-turns budget every run.
 */
export const MAX_CONSECUTIVE_PERSONA_PARSE_FAILURES = 3;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!env.SIMULATION_LLM_API_KEY) {
    throw Errors.simulationLlmNotConfigured();
  }
  if (!client) {
    client = new OpenAI({
      apiKey: env.SIMULATION_LLM_API_KEY,
      ...(env.SIMULATION_LLM_BASE_URL && {
        baseURL: env.SIMULATION_LLM_BASE_URL,
      }),
    });
  }
  return client;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  toolCalls: LlmToolCall[];
}

export interface PersonaMessageResponse {
  content: string;
  done: boolean;
  /**
   * True when the model ignored the JSON output contract and we fell back
   * to treating raw text as the customer utterance. Orchestrators use this
   * to force termination after several consecutive failures, since without
   * a `done` signal we'd otherwise burn SIMULATION_MAX_TURNS on every run.
   */
  parseFailed?: boolean;
}

/**
 * Convert ResolvedTool[] from MCP to OpenAI function-calling format.
 */
export function toOpenAiTools(tools: ResolvedTool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.mcpName,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * Rewrite an input message template in a persona's voice.
 *
 * Preserves all factual content (order IDs, names, dates) but changes
 * tone and style to match the persona. One LLM call, no multi-turn.
 */
export async function personalizeInputMessage(
  messageTemplate: string,
  persona: { name: string; systemPrompt: string },
): Promise<string> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: env.SIMULATION_LLM_MODEL,
    max_completion_tokens: SIMULATION_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content: `You are rewriting a customer message in the voice of a specific persona.

Persona: ${persona.name}
${persona.systemPrompt}

Rules:
- Rewrite the message as this persona would naturally say it
- Keep ALL factual content exactly the same (order IDs, product names, dates, numbers)
- Change only the tone, style, and phrasing
- Output ONLY the rewritten message, nothing else`,
      },
      { role: "user", content: messageTemplate },
    ],
  });

  const rewritten = response.choices[0]?.message?.content?.trim();
  if (!rewritten) {
    logger.warn("personalizeInputMessage returned empty — using original");
    return messageTemplate;
  }
  return rewritten;
}

/**
 * Generate the next persona (simulated customer) message.
 */
export async function generatePersonaMessage(
  messages: ChatCompletionMessageParam[],
  personaSystemPrompt: string,
): Promise<PersonaMessageResponse> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: env.SIMULATION_LLM_MODEL,
    max_completion_tokens: SIMULATION_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildPersonaSystemPrompt(personaSystemPrompt),
      },
      ...messages,
    ],
  });

  return parsePersonaMessageResponse(response.choices[0]?.message?.content);
}

/**
 * Generate the agent's response, with optional tool calling.
 */
export async function generateAgentResponse(
  messages: ChatCompletionMessageParam[],
  systemPrompt: string,
  tools: ChatCompletionTool[],
): Promise<LlmResponse> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: env.SIMULATION_LLM_MODEL,
    max_completion_tokens: SIMULATION_MAX_TOKENS,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    ...(tools.length > 0 && { tools }),
  });

  const choice = response.choices[0];
  const msg = choice?.message;

  const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? [])
    .filter(
      (tc): tc is Extract<typeof tc, { type: "function" }> =>
        tc.type === "function",
    )
    .map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        logger.warn(
          `malformed tool call arguments for ${tc.function.name}, falling back to {}`,
        );
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

  return {
    content: msg?.content ?? "",
    toolCalls,
  };
}

function buildPersonaSystemPrompt(personaSystemPrompt: string): string {
  return `${personaSystemPrompt.trim()}

Output contract:
- Stay fully in character as the customer.
- Respond with valid JSON only. No prose, no markdown, no code fences.
- Use exactly this shape: {"message":"<customer utterance>","done":false}
- Put only the customer's next utterance in "message".

How to set "done":
- Classify the "message" you are about to send. If that message itself is a farewell, sign-off, or explicit "no more questions" ("thanks, that's all", "no further questions", "goodbye", "have a good day", or the same thing in any other language), set "done" to true.
- Set "done" to true even when you are just echoing the agent's goodbye back — that is still a farewell.
- Set "done" to false in every other case: open questions, confirmations, clarifications, or a thanks that still expects a reply.
- Never set "done" to true on your very first message.`;
}

export function parsePersonaMessageResponse(
  rawContent: string | null | undefined,
): PersonaMessageResponse {
  const trimmed = rawContent?.trim() ?? "";
  if (!trimmed) {
    logger.warn("persona response returned empty content");
    return { content: "", done: false, parseFailed: true };
  }

  try {
    const parsed = JSON.parse(stripJsonCodeFence(trimmed)) as {
      message?: unknown;
      content?: unknown;
      done?: unknown;
    } | null;

    if (parsed && typeof parsed === "object") {
      const content =
        typeof parsed.message === "string"
          ? parsed.message.trim()
          : typeof parsed.content === "string"
            ? parsed.content.trim()
            : "";
      const done = typeof parsed.done === "boolean" ? parsed.done : false;

      if (content.length > 0) {
        return { content, done };
      }
    }

    logger.warn(
      { rawContent: trimmed.slice(0, 200) },
      "persona response JSON missing message field; falling back to raw text",
    );
  } catch {
    logger.warn(
      { rawContent: trimmed.slice(0, 200) },
      "persona response was not valid JSON; falling back to raw text",
    );
  }

  return { content: trimmed, done: false, parseFailed: true };
}

function stripJsonCodeFence(content: string): string {
  const match = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? content;
}
