import { describe, expect, test } from "bun:test";
import type { VerifierRule } from "../src/config/schemas.js";
import type { ConversationMessage, VerifierContext } from "../src/types.js";
import { RuleEngine } from "../src/verifier/rule-engine.js";

function makeHistory(
  ...entries: Array<{ role: "user" | "assistant"; content: string }>
): ConversationMessage[] {
  return entries.map((e) => ({
    ...e,
    timestamp: new Date().toISOString(),
  }));
}

function makeContext(
  overrides: Partial<VerifierContext> = {},
): VerifierContext {
  return {
    conversationHistory: [],
    turn: 1,
    sessionId: "test-session",
    ...overrides,
  };
}

// Stub MCP client — pre_check rules won't work without real MCP
const stubMcpClient = {
  connect: async () => {},
  discoverTools: async () => [],
  callTool: async () => ({ success: true, data: {} }),
  close: async () => {},
} as never;

const toolSemantics = {
  pizzapalace_get_order: { type: "lookup" as const },
  pizzapalace_add_to_cart: { type: "mutation" as const },
  pizzapalace_complete_cart: {
    type: "mutation" as const,
    requires_confirmation: true,
  },
};

describe("RuleEngine - trigger matching", () => {
  test("matches specific tool trigger", async () => {
    const rules: VerifierRule[] = [
      {
        id: "test-rule",
        description: "Test",
        severity: "error",
        trigger: { tool: "pizzapalace_get_order" },
        condition: {
          conversation_must_contain: [{ pattern: "name", from: "user" }],
        },
        on_fail: { action: "reject", message: "Blocked" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    // Should NOT match — wrong tool
    const results1 = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_add_to_cart",
          arguments: {},
        },
      }),
    );
    expect(results1.length).toBe(0);

    // SHOULD match — correct tool, but condition fails
    const results2 = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_get_order",
          arguments: { orderId: "123" },
        },
      }),
    );
    expect(results2.length).toBe(1);
    expect(results2[0].passed).toBe(false);
  });

  test("matches tool_type trigger", async () => {
    const rules: VerifierRule[] = [
      {
        id: "mutation-guard",
        description: "Block mutations without confirmation",
        severity: "error",
        trigger: { tool_type: "mutation" },
        condition: {
          conversation_must_contain: [
            {
              pattern: "\\b(yes|confirm)\\b",
              from: "user",
              within_last_n_turns: 4,
            },
          ],
        },
        on_fail: { action: "reject", message: "Confirm first" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    // Mutation without confirmation
    const results = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_add_to_cart",
          arguments: {},
        },
        conversationHistory: makeHistory(
          { role: "user", content: "Add a pizza" },
          { role: "assistant", content: "Sure, adding to cart" },
        ),
      }),
    );

    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].action).toBe("reject");
  });

  test("matches agent_message trigger", async () => {
    const rules: VerifierRule[] = [
      {
        id: "polite-language",
        description: "No rude language",
        severity: "warning",
        trigger: { type: "agent_message" },
        condition: {
          message_must_not_contain: [{ pattern: "\\bstupid\\b" }],
        },
        on_fail: { action: "rewrite", message: "Rude language detected" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    // Clean message
    const results1 = await engine.check(
      makeContext({ agentMessage: "How can I help you?" }),
    );
    expect(results1.length).toBe(1);
    expect(results1[0].passed).toBe(true);

    // Rude message
    const results2 = await engine.check(
      makeContext({ agentMessage: "That's a stupid question" }),
    );
    expect(results2.length).toBe(1);
    expect(results2[0].passed).toBe(false);
    expect(results2[0].action).toBe("rewrite");
  });
});

describe("RuleEngine - condition evaluation", () => {
  test("conversation_must_contain passes when pattern found", async () => {
    const rules: VerifierRule[] = [
      {
        id: "identity-check",
        description: "User must provide name",
        severity: "error",
        trigger: { tool: "pizzapalace_get_order" },
        condition: {
          conversation_must_contain: [
            { pattern: "\\b(my name is|I'm)\\b", from: "user" },
          ],
        },
        on_fail: { action: "reject", message: "Need name" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    // With name provided
    const results = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_get_order",
          arguments: { orderId: "123" },
        },
        conversationHistory: makeHistory(
          { role: "user", content: "Hi, my name is Jane" },
          { role: "assistant", content: "Hello Jane!" },
        ),
      }),
    );

    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(true);
  });

  test("conversation_must_contain with within_last_n_turns", async () => {
    const rules: VerifierRule[] = [
      {
        id: "recent-confirm",
        description: "Confirmation must be recent",
        severity: "error",
        trigger: { tool_type: "mutation" },
        condition: {
          conversation_must_contain: [
            {
              pattern: "\\byes\\b",
              from: "user",
              within_last_n_turns: 2,
            },
          ],
        },
        on_fail: { action: "reject", message: "Need recent confirmation" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    // "yes" was said too long ago (more than 2 turns ago)
    const oldHistory = makeHistory(
      { role: "user", content: "yes please" },
      { role: "assistant", content: "Ok" },
      { role: "user", content: "Something else" },
      { role: "assistant", content: "Sure" },
      { role: "user", content: "Another thing" },
      { role: "assistant", content: "Done" },
      { role: "user", content: "Now add to cart" },
      { role: "assistant", content: "Adding..." },
    );

    const results = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_add_to_cart",
          arguments: {},
        },
        conversationHistory: oldHistory,
      }),
    );

    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(false);
  });

  test("message_must_not_contain blocks matching messages", async () => {
    const rules: VerifierRule[] = [
      {
        id: "no-other-customers",
        description: "Don't mention other customers",
        severity: "error",
        trigger: { type: "agent_message" },
        condition: {
          message_must_not_contain: [{ pattern: "\\banother customer\\b" }],
        },
        on_fail: { action: "redact", message: "Mentions other customers" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    const results = await engine.check(
      makeContext({
        agentMessage: "Another customer had the same issue",
      }),
    );

    expect(results.length).toBe(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].action).toBe("redact");
  });

  test("params_grounded_in_conversation checks param values", async () => {
    const rules: VerifierRule[] = [
      {
        id: "grounded-id",
        description: "Order ID must be from conversation",
        severity: "warning",
        trigger: { tool: "pizzapalace_get_order" },
        condition: {
          params_grounded_in_conversation: [
            { param: "orderId", description: "Order ID from user" },
          ],
        },
        on_fail: { action: "reject", message: "ID not grounded" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    // Order ID mentioned by user
    const results1 = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_get_order",
          arguments: { orderId: "ord_12345" },
        },
        conversationHistory: makeHistory({
          role: "user",
          content: "My order ID is ord_12345",
        }),
      }),
    );
    expect(results1[0].passed).toBe(true);

    // Order ID NOT mentioned by user
    const results2 = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_get_order",
          arguments: { orderId: "ord_99999" },
        },
        conversationHistory: makeHistory({
          role: "user",
          content: "I need help with my order",
        }),
      }),
    );
    expect(results2[0].passed).toBe(false);
  });
});

describe("RuleEngine - actions", () => {
  test("reject action returns correct result", async () => {
    const rules: VerifierRule[] = [
      {
        id: "block-rule",
        description: "Block test",
        severity: "error",
        trigger: { tool: "pizzapalace_get_order" },
        condition: {
          conversation_must_contain: [{ pattern: "IMPOSSIBLE_PATTERN_12345" }],
        },
        on_fail: { action: "reject", message: "Blocked by test" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    const results = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_get_order",
          arguments: {},
        },
      }),
    );

    expect(results[0].passed).toBe(false);
    expect(results[0].action).toBe("reject");
    expect(results[0].message).toBe("Blocked by test");
  });

  test("escalate action returns correct result", async () => {
    const rules: VerifierRule[] = [
      {
        id: "escalate-rule",
        description: "Escalate test",
        severity: "error",
        trigger: { tool: "pizzapalace_get_order" },
        condition: {
          conversation_must_contain: [{ pattern: "IMPOSSIBLE_PATTERN_12345" }],
        },
        on_fail: { action: "escalate", message: "Needs supervisor" },
      },
    ];

    const engine = new RuleEngine(rules, toolSemantics, stubMcpClient);

    const results = await engine.check(
      makeContext({
        toolCall: {
          id: "1",
          name: "pizzapalace_get_order",
          arguments: {},
        },
      }),
    );

    expect(results[0].action).toBe("escalate");
  });
});
