/**
 * Shared LLM API client supporting Anthropic and OpenAI-compatible APIs.
 *
 * Provider is auto-detected from baseUrl:
 *   - Contains "anthropic" → Anthropic Messages API
 *   - Everything else      → OpenAI Chat Completions API
 */

import type { SessionMessage } from "@db/schema";

/** Timeout for LLM API calls in milliseconds. */
export const LLM_TIMEOUT_MS = 30_000;

/** Max characters for tool input/output in transcript to control prompt size. */
export const MAX_TOOL_FIELD_CHARS = 500;

/** HTTP status codes that indicate transient failures worth retrying. */
export const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Truncate a string to maxLen, appending "…(truncated)" if shortened. */
export function truncateField(value: unknown, maxLen: number): string {
  const str = JSON.stringify(value) ?? String(value);
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}…(truncated)`;
}

/**
 * Format session messages into a readable transcript for LLM consumption.
 */
export function formatTranscript(messages: SessionMessage[]): string {
  return messages
    .map((msg) => {
      if (msg.role === "tool") {
        const input = truncateField(msg.toolInput, MAX_TOOL_FIELD_CHARS);
        const output = truncateField(msg.toolOutput, MAX_TOOL_FIELD_CHARS);
        return `[tool:${msg.toolName ?? "unknown"}] input=${input} output=${output} status=${msg.toolStatus ?? "unknown"}`;
      }
      return `[${msg.role}] ${msg.content ?? "(no content)"}`;
    })
    .join("\n");
}

// ============================================================================
// LLM API transport
// ============================================================================

interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmApiRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  tools?: LlmToolDef[];
  tool_choice?: { type: "tool"; name: string };
  /** Request JSON output format (OpenAI only). */
  jsonOutput?: boolean;
}

export type LlmApiResult =
  | { ok: true; text: string }
  | { ok: true; toolInput: Record<string, unknown> }
  | { ok: false; kind: "transient" | "permanent"; reasoning: string };

type LlmProvider = "anthropic" | "openai";

/** Detect provider from base URL. Anthropic if URL contains "anthropic", else OpenAI. */
export function detectProvider(baseUrl: string): LlmProvider {
  return baseUrl.includes("anthropic") ? "anthropic" : "openai";
}

// ── Anthropic helpers ─────────────────────────────────────────────────

function buildAnthropicRequest(req: LlmApiRequest) {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 512,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  };
  if (req.tools?.length) {
    body.tools = req.tools;
  }
  if (req.tool_choice) {
    body.tool_choice = req.tool_choice;
  }
  return {
    url: `${req.baseUrl}/v1/messages`,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body,
  };
}

function parseAnthropicResponse(
  data: Record<string, unknown>,
  hasTools: boolean,
): LlmApiResult {
  const content = data.content as
    | Array<{ type: string; text?: string; input?: Record<string, unknown> }>
    | undefined;

  if (hasTools) {
    const toolUse = content?.find((c) => c.type === "tool_use");
    if (toolUse?.input) {
      return { ok: true, toolInput: toolUse.input };
    }
  }
  const text = content?.find((c) => c.type === "text")?.text;
  if (!text) {
    return {
      ok: false,
      kind: "permanent",
      reasoning: "LLM returned empty response",
    };
  }
  return { ok: true, text };
}

// ── OpenAI helpers ────────────────────────────────────────────────────

function buildOpenAIRequest(req: LlmApiRequest) {
  const body: Record<string, unknown> = {
    model: req.model,
    max_completion_tokens: req.maxTokens ?? 512,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }
  if (req.jsonOutput) {
    body.response_format = { type: "json_object" };
  }
  if (req.tool_choice) {
    body.tool_choice = {
      type: "function",
      function: { name: req.tool_choice.name },
    };
  }

  const base = req.baseUrl.replace(/\/+$/, "");
  return {
    url: `${base}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
    },
    body,
  };
}

function parseOpenAIResponse(
  data: Record<string, unknown>,
  hasTools: boolean,
): LlmApiResult {
  const choices = data.choices as
    | Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            function?: { arguments?: string };
          }>;
        };
      }>
    | undefined;

  const message = choices?.[0]?.message;
  if (!message) {
    return {
      ok: false,
      kind: "permanent",
      reasoning: "LLM returned empty response",
    };
  }

  if (hasTools && message.tool_calls?.length) {
    const args = message.tool_calls[0].function?.arguments;
    if (args) {
      try {
        return { ok: true, toolInput: JSON.parse(args) };
      } catch {
        return {
          ok: false,
          kind: "permanent",
          reasoning: `Failed to parse tool call arguments: ${args.slice(0, 200)}`,
        };
      }
    }
  }

  const text = message.content;
  if (!text) {
    // Include finish_reason and any refusal for debugging
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const finishReason = choice?.finish_reason ?? "unknown";
    const refusal = (message as Record<string, unknown>).refusal;
    const detail = refusal
      ? `refusal=${JSON.stringify(refusal)}`
      : `finish_reason=${finishReason}`;
    return {
      ok: false,
      kind: "permanent",
      reasoning: `LLM returned empty response (${detail})`,
    };
  }
  return { ok: true, text };
}

// ── Main entry point ──────────────────────────────────────────────────

/**
 * Call an LLM API with timeout and transient error handling.
 * Supports Anthropic Messages API and OpenAI Chat Completions API.
 *
 * When `tools` is provided, extracts tool call and returns
 * `{ ok: true, toolInput }`. Otherwise returns text.
 */
export async function callLlmApi(req: LlmApiRequest): Promise<LlmApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const provider = detectProvider(req.baseUrl);

  try {
    const { url, headers, body } =
      provider === "anthropic"
        ? buildAnthropicRequest(req)
        : buildOpenAIRequest(req);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const respBody = await response.text();
      const isTransient = TRANSIENT_STATUS_CODES.has(response.status);
      return {
        ok: false,
        kind: isTransient ? "transient" : "permanent",
        reasoning: `LLM API returned ${response.status}: ${respBody.slice(0, 200)}`,
      };
    }

    let data: Record<string, unknown>;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Malformed LLM JSON response";
      return {
        ok: false,
        kind: "permanent",
        reasoning: `LLM API JSON parse error: ${message}`,
      };
    }

    const hasTools = !!req.tools?.length;
    return provider === "anthropic"
      ? parseAnthropicResponse(data, hasTools)
      : parseOpenAIResponse(data, hasTools);
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : "Unknown LLM error";
    const isTimeout = err instanceof Error && err.name === "AbortError";

    return {
      ok: false,
      kind: "transient",
      reasoning: isTimeout
        ? `LLM API timed out after ${LLM_TIMEOUT_MS}ms`
        : `LLM API error: ${message}`,
    };
  }
}
