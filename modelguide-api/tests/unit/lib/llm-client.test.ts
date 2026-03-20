/**
 * Unit tests for the shared LLM client.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SessionMessage } from "@db/schema";
import { callLlmApi, formatTranscript, truncateField } from "@lib/llm-client";

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

const baseReq = {
  baseUrl: "http://localhost:9999",
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
// callLlmApi — text mode
// ============================================================================

describe("callLlmApi", () => {
  test("returns text on successful response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(anthropicTextResponse("hello world")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(baseReq);
    expect(result.ok).toBe(true);
    if (result.ok && "text" in result) {
      expect(result.text).toBe("hello world");
    }
  });

  test("returns transient failure on 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Rate limited", { status: 429 })),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(baseReq);
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

    const result = await callLlmApi(baseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("permanent");
      expect(result.reasoning).toContain("401");
    }
  });

  test("returns permanent failure on empty response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(baseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasoning).toContain("empty response");
    }
  });

  test("returns transient failure on fetch error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Connection refused")),
    ) as unknown as typeof fetch;

    const result = await callLlmApi(baseReq);
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

    const result = await callLlmApi(baseReq);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("transient");
      expect(result.reasoning).toContain("timed out");
    }
  });

  // ── Tool use mode ─────────────────────────────────────────────────

  test("returns toolInput when tools are provided and LLM uses tool", async () => {
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
      ...baseReq,
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

  test("sends tools and tool_choice in request body", async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = mock(
      (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              anthropicToolResponse("classify_sop", {
                sop_slug: null,
                confidence: 0.5,
                reasoning: "no match",
              }),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    ) as unknown as typeof fetch;

    await callLlmApi({
      ...baseReq,
      tools: [
        {
          name: "classify_sop",
          description: "Classify",
          input_schema: { type: "object", properties: {} },
        },
      ],
      tool_choice: { type: "tool", name: "classify_sop" },
    });

    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe("classify_sop");
    expect(parsed.tool_choice).toEqual({ type: "tool", name: "classify_sop" });
  });
});
