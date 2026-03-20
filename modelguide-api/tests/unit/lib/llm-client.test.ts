/**
 * Unit tests for the shared LLM client.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SessionMessage } from "@db/schema";
import {
  callLlmApi,
  detectProvider,
  formatTranscript,
  truncateField,
} from "@lib/llm-client";

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(
  overrides: Partial<SessionMessage> & { role: string },
): SessionMessage {
  return {
    id: "m1",
    sessionId: "s1",
    role: overrides.role as SessionMessage["role"],
    content: overrides.content ?? null,
    audioUrl: null,
    audioDurationMs: null,
    toolCallId: overrides.toolCallId ?? null,
    toolName: overrides.toolName ?? null,
    toolInput: overrides.toolInput ?? null,
    toolOutput: overrides.toolOutput ?? null,
    toolStatus: overrides.toolStatus ?? null,
    modelUsed: null,
    tokensUsed: null,
    latencyMs: null,
    occurredAt: new Date(),
    createdAt: new Date(),
  };
}

// ── Anthropic mock responses ──────────────────────────────────────────

function anthropicTextResponse(text: string) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "mock-model",
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function anthropicToolResponse(name: string, input: Record<string, unknown>) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "call_1", name, input }],
    model: "mock-model",
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// ── OpenAI mock responses ─────────────────────────────────────────────

function openaiTextResponse(text: string) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

function openaiToolResponse(name: string, input: Record<string, unknown>) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: JSON.stringify(input) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

const anthropicBaseReq = {
  baseUrl: "https://api.anthropic.com",
  apiKey: "test-key",
  model: "test-model",
  system: "You are a test.",
  user: "Test prompt",
};

const openaiBaseReq = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "test-key",
  model: "test-model",
  system: "You are a test.",
  user: "Test prompt",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================================
// detectProvider
// ============================================================================

describe("detectProvider", () => {
  test("detects anthropic from URL", () => {
    expect(detectProvider("https://api.anthropic.com")).toBe("anthropic");
    expect(detectProvider("https://api.anthropic.com/v1")).toBe("anthropic");
  });

  test("detects openai from URL", () => {
    expect(detectProvider("https://api.openai.com/v1")).toBe("openai");
  });

  test("defaults to openai for unknown URLs", () => {
    expect(detectProvider("https://my-llm-proxy.example.com")).toBe("openai");
    expect(detectProvider("http://localhost:8080")).toBe("openai");
  });
});

// ============================================================================
// formatTranscript
// ============================================================================

describe("formatTranscript", () => {
  test("formats user and assistant messages", () => {
    const messages = [
      makeMessage({ role: "user", content: "Hello" }),
      makeMessage({ role: "assistant", content: "Hi there!" }),
    ];
    const result = formatTranscript(messages);
    expect(result).toBe("[user] Hello\n[assistant] Hi there!");
  });

  test("formats tool messages with truncation", () => {
    const messages = [
      makeMessage({
        role: "tool",
        toolName: "test_tool",
        toolInput: { key: "value" },
        toolOutput: { result: "ok" },
        toolStatus: "success",
      }),
    ];
    const result = formatTranscript(messages);
    expect(result).toContain("[tool:test_tool]");
    expect(result).toContain("status=success");
  });

  test("handles null content", () => {
    const messages = [makeMessage({ role: "user", content: null })];
    const result = formatTranscript(messages);
    expect(result).toBe("[user] (no content)");
  });
});

// ============================================================================
// truncateField
// ============================================================================

describe("truncateField", () => {
  test("returns short strings unchanged", () => {
    expect(truncateField("hello", 100)).toBe('"hello"');
  });

  test("truncates long strings", () => {
    const long = "a".repeat(600);
    const result = truncateField(long, 100);
    expect(result.length).toBeLessThan(120);
    expect(result).toContain("…(truncated)");
  });
});

// ============================================================================
// callLlmApi — Anthropic provider
// ============================================================================

describe("callLlmApi — Anthropic", () => {
  test("returns text on successful response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(anthropicTextResponse("hello world")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(anthropicBaseReq);
    expect(result.ok).toBe(true);
    if (result.ok && "text" in result) {
      expect(result.text).toBe("hello world");
    }
  });

  test("sends correct Anthropic headers and body shape", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = mock(
      (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers ?? {}),
        );
        capturedBody = JSON.parse(init?.body as string);
        return Promise.resolve(
          new Response(JSON.stringify(anthropicTextResponse("ok")), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    ) as unknown as typeof fetch;

    await callLlmApi(anthropicBaseReq);

    expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(capturedHeaders["x-api-key"]).toBe("test-key");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedBody.system).toBe("You are a test.");
    expect(capturedBody.messages).toEqual([
      { role: "user", content: "Test prompt" },
    ]);
  });

  test("returns toolInput when tools are provided", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            anthropicToolResponse("classify_sop", {
              sop_slug: "order-lookup",
              confidence: 0.9,
              reasoning: "Matches order inquiry",
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi({
      ...anthropicBaseReq,
      tools: [
        {
          name: "classify_sop",
          description: "Classify SOP",
          input_schema: { type: "object", properties: {} },
        },
      ],
      tool_choice: { type: "tool", name: "classify_sop" },
    });

    expect(result.ok).toBe(true);
    if (result.ok && "toolInput" in result) {
      expect(result.toolInput).toEqual({
        sop_slug: "order-lookup",
        confidence: 0.9,
        reasoning: "Matches order inquiry",
      });
    }
  });
});

// ============================================================================
// callLlmApi — OpenAI provider
// ============================================================================

describe("callLlmApi — OpenAI", () => {
  test("returns text on successful response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(openaiTextResponse("hello world")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(openaiBaseReq);
    expect(result.ok).toBe(true);
    if (result.ok && "text" in result) {
      expect(result.text).toBe("hello world");
    }
  });

  test("sends correct OpenAI headers and body shape", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = mock(
      (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers ?? {}),
        );
        capturedBody = JSON.parse(init?.body as string);
        return Promise.resolve(
          new Response(JSON.stringify(openaiTextResponse("ok")), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    ) as unknown as typeof fetch;

    await callLlmApi(openaiBaseReq);

    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedHeaders.Authorization).toBe("Bearer test-key");
    expect(capturedHeaders["x-api-key"]).toBeUndefined();
    expect(capturedBody.messages).toEqual([
      { role: "system", content: "You are a test." },
      { role: "user", content: "Test prompt" },
    ]);
  });

  test("returns toolInput when tools are provided", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            openaiToolResponse("classify_sop", {
              sop_slug: "order-lookup",
              confidence: 0.9,
              reasoning: "Matches order inquiry",
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi({
      ...openaiBaseReq,
      tools: [
        {
          name: "classify_sop",
          description: "Classify SOP",
          input_schema: { type: "object", properties: {} },
        },
      ],
      tool_choice: { type: "tool", name: "classify_sop" },
    });

    expect(result.ok).toBe(true);
    if (result.ok && "toolInput" in result) {
      expect(result.toolInput).toEqual({
        sop_slug: "order-lookup",
        confidence: 0.9,
        reasoning: "Matches order inquiry",
      });
    }
  });

  test("sends tools in OpenAI function format", async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = mock(
      (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return Promise.resolve(
          new Response(
            JSON.stringify(
              openaiToolResponse("classify_sop", { sop_slug: null }),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    ) as unknown as typeof fetch;

    await callLlmApi({
      ...openaiBaseReq,
      tools: [
        {
          name: "classify_sop",
          description: "Classify",
          input_schema: { type: "object", properties: {} },
        },
      ],
      tool_choice: { type: "tool", name: "classify_sop" },
    });

    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect((tools[0].function as Record<string, unknown>).name).toBe(
      "classify_sop",
    );

    const toolChoice = capturedBody.tool_choice as Record<string, unknown>;
    expect(toolChoice.type).toBe("function");
    expect((toolChoice.function as Record<string, unknown>).name).toBe(
      "classify_sop",
    );
  });
});

// ============================================================================
// callLlmApi — shared error handling
// ============================================================================

describe("callLlmApi — error handling", () => {
  test("returns transient failure on 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Rate limited", { status: 429 })),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(openaiBaseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("transient");
      expect(result.reasoning).toContain("429");
    }
  });

  test("returns permanent failure on 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(openaiBaseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("permanent");
      expect(result.reasoning).toContain("401");
    }
  });

  test("returns permanent failure on empty response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: null } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(openaiBaseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasoning).toContain("empty response");
    }
  });

  test("returns transient failure on fetch error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Connection refused")),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(openaiBaseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("transient");
      expect(result.reasoning).toContain("Connection refused");
    }
  });

  test("returns transient failure on timeout", async () => {
    globalThis.fetch = mock(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    }) as unknown as typeof fetch;

    const result = await callLlmApi(openaiBaseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("transient");
      expect(result.reasoning).toContain("timed out");
    }
  });
});
