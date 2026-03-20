/**
 * Shared LLM API client for Anthropic Messages API.
 *
 * Extracted from llm-judge.ts for reuse across evaluators and classifiers.
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
}

export type LlmApiResult =
  | { ok: true; text: string }
  | { ok: true; toolInput: Record<string, unknown> }
  | { ok: false; kind: "transient" | "permanent"; reasoning: string };

/**
 * Call the Anthropic Messages API with timeout and transient error handling.
 *
 * When `tools` is provided, extracts `tool_use` content block and returns
 * `{ ok: true, toolInput }`. Otherwise falls back to text extraction.
 */
export async function callLlmApi(req: LlmApiRequest): Promise<LlmApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
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

    const response = await fetch(`${req.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
      },
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

    let data: {
      content?: Array<{
        type: string;
        text?: string;
        input?: Record<string, unknown>;
      }>;
    };
    try {
      data = (await response.json()) as typeof data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Malformed LLM JSON response";
      return {
        ok: false,
        kind: "permanent",
        reasoning: `LLM API JSON parse error: ${message}`,
      };
    }

    // When tools were requested, look for tool_use content block first
    if (req.tools?.length) {
      const toolUse = data.content?.find((c) => c.type === "tool_use");
      if (toolUse?.input) {
        return { ok: true, toolInput: toolUse.input };
      }
      // Fall through to text extraction if no tool_use block
    }

    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) {
      return {
        ok: false,
        kind: "permanent",
        reasoning: "LLM returned empty response",
      };
    }

    return { ok: true, text };
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
