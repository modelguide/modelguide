import { describe, expect, mock, test } from "bun:test";
import { parsePersonaMessageResponse } from "@features/simulations/llm-client";
import confusedBrowser from "../../fixtures/simulations/confused-browser.json";
import impatientReturner from "../../fixtures/simulations/impatient-returner.json";
import politeBuyer from "../../fixtures/simulations/polite-buyer.json";

// ============================================================================
// parsePersonaMessageResponse
// ============================================================================

describe("parsePersonaMessageResponse", () => {
  test("parses structured persona output", () => {
    expect(
      parsePersonaMessageResponse(
        '{"message":"Thanks for your help.","done":true}',
      ),
    ).toEqual({
      content: "Thanks for your help.",
      done: true,
    });
  });

  test("accepts json wrapped in code fences", () => {
    expect(
      parsePersonaMessageResponse(
        '```json\n{"message":"I need one more detail.","done":false}\n```',
      ),
    ).toEqual({
      content: "I need one more detail.",
      done: false,
    });
  });

  test("falls back to raw text when the model ignores the json contract", () => {
    expect(parsePersonaMessageResponse("Goodbye for now")).toEqual({
      content: "Goodbye for now",
      done: false,
    });
  });
});

describe("runSimulation", () => {
  test("stops after the agent replies to a persona turn marked done", async () => {
    const addMessage = mock(async () => ({ id: "mock-message-id" }));

    mock.module("@features/mcp/mcp.service", () => ({
      executeTool: async () => ({}),
      getAgentTools: async () => [],
      resolveConnectorConfigById: async () => ({}),
    }));

    mock.module("@features/sessions/sessions.service", () => ({
      addMessage,
      createSession: async () => ({ id: "mock-session-id" }),
      updateSession: async () => ({}),
    }));

    mock.module("@db/rls", () => ({
      forOrg: async (_orgId: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          update: () => ({
            set: () => ({
              where: async () => ({}),
            }),
          }),
        }),
    }));

    mock.module("@features/simulations/llm-client", () => ({
      generateAgentResponse: async () => ({
        content: "Happy to help. Goodbye!",
        toolCalls: [],
      }),
      generatePersonaMessage: async () => ({
        content: "Thanks, that's all I needed.",
        done: true,
      }),
      toOpenAiTools: () => [],
    }));

    const { runSimulation } = await import(
      "@features/simulations/orchestrator"
    );

    const result = await runSimulation({
      orgId: "org-1",
      agentId: "agent-1",
      agentName: "Test Agent",
      persona: {
        id: "test-persona",
        name: "Test Persona",
        description: "Test persona",
        systemPrompt: "You are a customer",
        traits: ["test"],
      },
      maxTurns: 5,
    });

    expect(result.status).toBe("completed");
    expect(result.turnCount).toBe(1);
    expect(addMessage).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Fixture structure validation
// ============================================================================

describe("simulation fixtures", () => {
  const fixtures = [
    { name: "polite-buyer", data: politeBuyer },
    { name: "impatient-returner", data: impatientReturner },
    { name: "confused-browser", data: confusedBrowser },
  ];

  for (const { name, data } of fixtures) {
    test(`${name} has required fields`, () => {
      expect(data.personaId).toBe(name);
      expect(data.expectedToolCalls).toBeArray();
      expect(data.expectedTurnRange).toBeArrayOfSize(2);
      expect(data.expectedTurnRange[0]).toBeLessThanOrEqual(
        data.expectedTurnRange[1],
      );
      expect(data.expectedTraits).toBeDefined();
      expect(data.messages).toBeArray();
      expect(data.messages.length).toBeGreaterThan(0);
    });

    test(`${name} messages have valid roles`, () => {
      const validRoles = ["user", "assistant", "tool"];
      for (const msg of data.messages) {
        expect(validRoles).toContain(msg.role);
      }
    });
  }
});
