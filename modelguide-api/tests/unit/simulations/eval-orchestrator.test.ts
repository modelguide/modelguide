/**
 * Unit tests for eval orchestrator.
 *
 * Tests conversation loop behavior with mock adapters:
 * - Single-turn completion (no persona)
 * - Timeout handling (AC 13)
 * - conversationEnded signal stops loop (AC 12)
 */

import { describe, expect, mock, test } from "bun:test";
import type { AgentAdapter } from "@features/simulations/adapters/agent-adapter";
import { runEvalSimulation } from "@features/simulations/eval-orchestrator";

// Mock session service — orchestrator creates sessions and messages
mock.module("@features/sessions/sessions.service", () => ({
  createSession: async () => ({ id: "mock-session-id" }),
  addMessage: async () => ({ id: "mock-msg-id" }),
  updateSession: async () => ({}),
}));

function createMockAdapter(
  response = "Agent response",
  conversationEnded = true,
): AgentAdapter {
  return {
    sendMessage: async () => ({
      response,
      toolCalls: [],
      conversationEnded,
    }),
  };
}

describe("runEvalSimulation", () => {
  test("completes single-turn without persona", async () => {
    const adapter = createMockAdapter("Hello!", true);
    const result = await runEvalSimulation({
      orgId: "org-1",
      agentId: "agent-1",
      adapter,
      inputMessage: "Hi there",
      sessionId: "pre-created-session",
    });

    expect(result.status).toBe("completed");
    expect(result.turnCount).toBe(1);
    expect(result.sessionId).toBe("pre-created-session");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns timeout status when simulation exceeds timeout", async () => {
    // Adapter that takes 200ms per call
    const slowAdapter: AgentAdapter = {
      sendMessage: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { response: "slow", toolCalls: [], conversationEnded: false };
      },
    };

    // Mock persona to enable multi-turn
    mock.module("@features/simulations/llm-client", () => ({
      generatePersonaMessage: async () => ({ content: "follow up" }),
    }));

    const result = await runEvalSimulation({
      orgId: "org-1",
      agentId: "agent-1",
      adapter: slowAdapter,
      inputMessage: "Hi",
      persona: {
        id: "test-persona",
        name: "Test Customer",
        description: "Test persona",
        systemPrompt: "You are a customer",
        traits: ["test"],
      },
      sessionId: "pre-created-session",
      timeoutMs: 100, // 100ms timeout
      maxTurns: 10,
    });

    expect(result.status).toBe("timeout");
    // Should have completed at most 1 turn before timeout
    expect(result.turnCount).toBeLessThanOrEqual(2);
  });

  test("stops when adapter signals conversationEnded", async () => {
    let callCount = 0;
    const adapter: AgentAdapter = {
      sendMessage: async () => {
        callCount++;
        return {
          response: `Response ${callCount}`,
          toolCalls: [],
          conversationEnded: true, // Always end
        };
      },
    };

    const result = await runEvalSimulation({
      orgId: "org-1",
      agentId: "agent-1",
      adapter,
      inputMessage: "Hi",
      persona: {
        id: "test-persona",
        name: "Test Customer",
        description: "Test persona",
        systemPrompt: "You are a customer",
        traits: ["test"],
      },
      sessionId: "pre-created-session",
      maxTurns: 10,
    });

    expect(result.status).toBe("completed");
    expect(result.turnCount).toBe(1);
    expect(callCount).toBe(1);
  });

  test("returns error status on adapter failure", async () => {
    const failingAdapter: AgentAdapter = {
      sendMessage: async () => {
        throw new Error("LLM provider error");
      },
    };

    const result = await runEvalSimulation({
      orgId: "org-1",
      agentId: "agent-1",
      adapter: failingAdapter,
      inputMessage: "Hi",
      sessionId: "pre-created-session",
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("LLM provider error");
  });
});
