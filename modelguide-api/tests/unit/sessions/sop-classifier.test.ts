/**
 * Unit tests for the server-side SOP classifier.
 *
 * Mocks resolveAgentSops via mock.module and uses globalThis.fetch for LLM
 * (same pattern as llm-judge tests — avoids mock.module on @lib/llm-client
 * which would bleed into other test files).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SessionMessage } from "@db/schema";
import { overrideEnv, restoreEnv } from "../../helpers/test-env";

// ============================================================================
// Module mocks — only mock the DB dependency, not the LLM client
// ============================================================================

const mockResolveAgentSops = mock(() =>
  Promise.resolve([
    {
      slug: "order-lookup",
      name: "Order Lookup",
      description: "Help customers check order status",
    },
    {
      slug: "return-process",
      name: "Return Process",
      description: "Guide customers through returns",
    },
  ]),
);

mock.module("@features/mcp/mcp.service", () => ({
  resolveAgentSops: mockResolveAgentSops,
}));

// Import after mocking (only mcp.service is mocked, llm-client is real)
const { classifySessionSop } = await import(
  "@features/sessions/sop-classifier.service"
);

// ============================================================================
// Helpers
// ============================================================================

function makeMessages(count = 2): SessionMessage[] {
  const msgs: SessionMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      id: `m${i}`,
      sessionId: "s1",
      role: i % 2 === 0 ? "user" : "assistant",
      content:
        i % 2 === 0 ? "Where is my order?" : "Let me check that for you.",
      audioUrl: null,
      audioDurationMs: null,
      toolCallId: null,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      toolStatus: null,
      modelUsed: null,
      tokensUsed: null,
      latencyMs: null,
      occurredAt: new Date(),
      createdAt: new Date(),
    });
  }
  return msgs;
}

/** Build a mock Anthropic tool_use response. */
function anthropicToolResponse(input: Record<string, unknown>) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "call_1", name: "classify_sop", input }],
    model: "mock-model",
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/** Build a mock Anthropic text response (no tool use). */
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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
  mockResolveAgentSops.mockReset();
  mockResolveAgentSops.mockImplementation(() =>
    Promise.resolve([
      {
        slug: "order-lookup",
        name: "Order Lookup",
        description: "Help customers check order status",
      },
      {
        slug: "return-process",
        name: "Return Process",
        description: "Guide customers through returns",
      },
    ]),
  );
});

// ============================================================================
// Tests
// ============================================================================

describe("classifySessionSop", () => {
  test("returns null when EVAL_LLM_API_KEY is not set", async () => {
    overrideEnv("EVAL_LLM_API_KEY", undefined);

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );
    expect(result).toBeNull();
  });

  test("returns null when agent has no SOPs", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");
    mockResolveAgentSops.mockImplementation(() => Promise.resolve([]));

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );
    expect(result).toBeNull();
  });

  test("returns null when messages are empty", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");

    const result = await classifySessionSop("org1", "agent1", "s1", []);
    expect(result).toBeNull();
  });

  test("returns valid classification with source=server", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            anthropicToolResponse({
              sop_slug: "order-lookup",
              confidence: 0.92,
              reasoning: "Customer asking about order status",
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );

    expect(result).not.toBeNull();
    expect(result!.sop_slug).toBe("order-lookup");
    expect(result!.sop_name).toBe("Order Lookup");
    expect(result!.confidence).toBe(0.92);
    expect(result!.unknown).toBe(false);
    expect(result!.source).toBe("server");
  });

  test("returns unknown when LLM returns null slug", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            anthropicToolResponse({
              sop_slug: null,
              confidence: 0.3,
              reasoning: "No matching SOP",
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );

    expect(result).not.toBeNull();
    expect(result!.sop_slug).toBeNull();
    expect(result!.unknown).toBe(true);
    expect(result!.source).toBe("server");
  });

  test("treats unknown slug as unknown classification", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            anthropicToolResponse({
              sop_slug: "nonexistent-sop",
              confidence: 0.7,
              reasoning: "Guessing",
            }),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );

    expect(result).not.toBeNull();
    expect(result!.sop_slug).toBeNull();
    expect(result!.unknown).toBe(true);
    expect(result!.source).toBe("server");
  });

  test("returns null when LLM call fails", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Service unavailable", { status: 503 })),
    ) as unknown as typeof fetch;

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );
    expect(result).toBeNull();
  });

  test("returns null when LLM returns text instead of tool use", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(anthropicTextResponse("I think it's order-lookup")),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await classifySessionSop(
      "org1",
      "agent1",
      "s1",
      makeMessages(),
    );
    expect(result).toBeNull();
  });
});
