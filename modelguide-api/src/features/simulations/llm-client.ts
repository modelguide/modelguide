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
 * Generate the next persona (simulated customer) message.
 */
export async function generatePersonaMessage(
  messages: ChatCompletionMessageParam[],
  personaSystemPrompt: string,
): Promise<LlmResponse> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: env.SIMULATION_LLM_MODEL,
    max_completion_tokens: SIMULATION_MAX_TOKENS,
    messages: [{ role: "system", content: personaSystemPrompt }, ...messages],
  });

  const choice = response.choices[0];
  return {
    content: choice?.message?.content ?? "",
    toolCalls: [],
  };
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
