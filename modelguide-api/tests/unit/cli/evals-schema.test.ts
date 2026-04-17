import { describe, expect, test } from "bun:test";
import {
  evalScenariosJsonSchema,
  evalsYamlFileSchema,
  normalizeJson,
  normalizeYaml,
} from "../../../src/cli/schemas/evals.schema";

// ============================================================================
// YAML schema
// ============================================================================

describe("evalsYamlFileSchema", () => {
  const validYaml = {
    agentSlug: "test-agent",
    evaluators: [
      { name: "checks-order", criterion: "Agent checks the order" },
      { name: "no-fabrication", criterion: "Agent does not fabricate" },
    ],
    test_cases: [
      {
        id: "tc-01",
        sop_slug: "order-lookup",
        evaluators: ["checks-order", "no-fabrication"],
        input: { customer_message: "Where is my order?" },
      },
    ],
  };

  test("validates correct YAML input", () => {
    const result = evalsYamlFileSchema.safeParse(validYaml);
    expect(result.success).toBe(true);
  });

  test("accepts evaluators with tags", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      evaluators: [
        {
          name: "checks-order",
          criterion: "Agent checks the order",
          tags: ["accuracy", "compliance"],
        },
        { name: "no-fabrication", criterion: "Agent does not fabricate" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evaluators[0].tags).toEqual([
        "accuracy",
        "compliance",
      ]);
      expect(result.data.evaluators[1].tags).toEqual([]);
    }
  });

  test("accepts optional test case fields", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          scenario_key: "order_status",
          description: "Happy path for order lookup flow",
          tags: ["happy-path"],
          guardrails_tested: ["no-medical-claims"],
          evaluators: ["checks-order"],
          input: {
            customer_message: "Check order",
            conversation_history: [
              { role: "assistant", content: "How can I help?" },
            ],
            context: { orderId: "123" },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts candidate_message as alternative to customer_message", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          evaluators: ["checks-order"],
          input: { candidate_message: "Yes I have a license" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing agentSlug", () => {
    const { agentSlug: _, ...noSlug } = validYaml;
    const result = evalsYamlFileSchema.safeParse(noSlug);
    expect(result.success).toBe(false);
  });

  test("rejects empty evaluators", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      evaluators: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty test_cases", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      test_cases: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects undefined evaluator references", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          evaluators: ["nonexistent-evaluator"],
          input: { customer_message: "Hello" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects input without customer_message or candidate_message", () => {
    const result = evalsYamlFileSchema.safeParse({
      ...validYaml,
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          evaluators: ["checks-order"],
          input: { conversation_history: [] },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("common_evaluators defaults to empty array", () => {
    const result = evalsYamlFileSchema.safeParse({
      agentSlug: "test-agent",
      evaluators: [
        { name: "checks-order", criterion: "Agent checks the order" },
        { name: "no-fabrication", criterion: "Agent does not fabricate" },
      ],
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          evaluators: ["checks-order", "no-fabrication"],
          input: { customer_message: "Where is my order?" },
        },
      ],
      // no common_evaluators key
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.common_evaluators).toEqual([]);
    }
  });

  test("rejects common_evaluators referencing undefined evaluator name", () => {
    const result = evalsYamlFileSchema.safeParse({
      agentSlug: "test-agent",
      evaluators: [
        { name: "checks-order", criterion: "Agent checks the order" },
      ],
      common_evaluators: ["nonexistent-evaluator"],
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          evaluators: ["checks-order"],
          input: { customer_message: "Where is my order?" },
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "undefined evaluators: nonexistent-evaluator",
      );
    }
  });
});

// ============================================================================
// JSON schema
// ============================================================================

describe("evalScenariosJsonSchema", () => {
  const validJson = [
    {
      id: "scenario-01",
      sop_slug: "order-lookup",
      input: { customer_message: "Where is my order?" },
      expected_output: { criteria: ["Agent checks order status"] },
    },
  ];

  test("validates correct JSON input", () => {
    const result = evalScenariosJsonSchema.safeParse(validJson);
    expect(result.success).toBe(true);
  });

  test("rejects empty array", () => {
    const result = evalScenariosJsonSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  test("rejects scenario without criteria", () => {
    const result = evalScenariosJsonSchema.safeParse([
      {
        id: "s-01",
        sop_slug: "sop",
        input: { customer_message: "Hi" },
        expected_output: { criteria: [] },
      },
    ]);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// normalizeYaml
// ============================================================================

describe("normalizeYaml", () => {
  test("normalizes YAML to internal format", () => {
    const parsed = evalsYamlFileSchema.parse({
      agentSlug: "test-agent",
      evaluators: [
        {
          name: "checks-order",
          criterion: "Agent checks order",
          tags: ["accuracy"],
        },
      ],
      test_cases: [
        {
          id: "tc-01",
          sop_slug: "order-lookup",
          scenario_key: "order_status",
          tags: ["happy-path"],
          evaluators: ["checks-order"],
          input: {
            customer_message: "Check my order",
            conversation_history: [{ role: "assistant", content: "Hello!" }],
          },
        },
      ],
    });

    const result = normalizeYaml(parsed);

    expect(result.agentSlug).toBe("test-agent");
    expect(result.evaluators).toHaveLength(1);
    expect(result.evaluators[0].name).toBe("checks-order");
    expect(result.evaluators[0].criterion).toBe("Agent checks order");
    expect(result.evaluators[0].tags).toEqual(["accuracy"]);

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].id).toBe("tc-01");
    expect(result.testCases[0].sopSlug).toBe("order-lookup");
    expect(result.testCases[0].scenarioKey).toBe("order_status");
    expect(result.testCases[0].tags).toEqual(["happy-path"]);
    expect(result.testCases[0].evaluatorNames).toEqual(["checks-order"]);
    expect(result.testCases[0].input.message).toBe("Check my order");
    expect(result.testCases[0].input.conversationHistory).toHaveLength(1);
  });

  test("normalizes customer_message to message", () => {
    const parsed = evalsYamlFileSchema.parse({
      agentSlug: "agent",
      evaluators: [{ name: "e1", criterion: "c1" }],
      test_cases: [
        {
          id: "tc",
          sop_slug: "sop",
          evaluators: ["e1"],
          input: { customer_message: "Hello" },
        },
      ],
    });
    const result = normalizeYaml(parsed);
    expect(result.testCases[0].input.message).toBe("Hello");
  });

  test("passes common_evaluators through as commonEvaluatorNames", () => {
    const parsed = evalsYamlFileSchema.parse({
      agentSlug: "agent",
      evaluators: [
        { name: "guardrail-a", criterion: "Agent does not lie" },
        { name: "guardrail-b", criterion: "Agent stays on topic" },
      ],
      common_evaluators: ["guardrail-a"],
      test_cases: [
        {
          id: "tc-1",
          sop_slug: "sop",
          evaluators: ["guardrail-a", "guardrail-b"],
          input: { customer_message: "Hello" },
        },
      ],
    });

    const result = normalizeYaml(parsed);

    expect(result.commonEvaluatorNames).toEqual(["guardrail-a"]);
    expect(result.testCases[0].evaluatorNames).toEqual([
      "guardrail-a",
      "guardrail-b",
    ]);
  });
});

// ============================================================================
// normalizeJson
// ============================================================================

describe("normalizeJson", () => {
  test("extracts unique evaluators from criteria", () => {
    const scenarios = evalScenariosJsonSchema.parse([
      {
        id: "s-01",
        sop_slug: "sop-a",
        input: { customer_message: "Hello" },
        expected_output: {
          criteria: ["Agent greets customer", "Agent asks for order number"],
        },
      },
      {
        id: "s-02",
        sop_slug: "sop-a",
        input: { customer_message: "Hi" },
        expected_output: {
          criteria: ["Agent greets customer"],
        },
      },
    ]);

    const result = normalizeJson(scenarios, "my-agent");

    expect(result.agentSlug).toBe("my-agent");
    // 2 unique criteria → 2 evaluators
    expect(result.evaluators).toHaveLength(2);
    // JSON-derived evaluators get empty tags
    expect(result.evaluators[0].tags).toEqual([]);

    expect(result.testCases).toHaveLength(2);
    expect(result.testCases[0].evaluatorNames).toHaveLength(2);
    // Second test case references only one evaluator
    expect(result.testCases[1].evaluatorNames).toHaveLength(1);
    // Should reference the same evaluator name as first scenario's first criterion
    expect(result.testCases[1].evaluatorNames[0]).toBe(
      result.testCases[0].evaluatorNames[0],
    );
  });

  test("handles duplicate criterion names with suffix", () => {
    // Two different criteria that slugify to the same name
    const scenarios = evalScenariosJsonSchema.parse([
      {
        id: "s-01",
        sop_slug: "sop",
        input: { customer_message: "Hello" },
        expected_output: {
          criteria: [
            "Agent greets!", // → agent-greets
            "Agent greets.", // → agent-greets (duplicate)
          ],
        },
      },
    ]);

    const result = normalizeJson(scenarios, "agent");
    expect(result.evaluators).toHaveLength(2);
    // Names should be unique
    const names = result.evaluators.map((e) => e.name);
    expect(new Set(names).size).toBe(2);
  });

  test("normalizeJson always returns empty commonEvaluatorNames", () => {
    const scenarios = evalScenariosJsonSchema.parse([
      {
        id: "s-01",
        sop_slug: "sop",
        input: { customer_message: "Hi" },
        expected_output: { criteria: ["Agent responds politely"] },
      },
    ]);

    const result = normalizeJson(scenarios, "agent");
    expect(result.commonEvaluatorNames).toEqual([]);
  });
});
