import { describe, expect, test } from "bun:test";
import type { TaskConfig } from "../src/config/schemas.js";
import { Evaluator, computeAggregateMetrics } from "../src/evaluator.js";
import type { ConversationResult, TaskEvaluation } from "../src/types.js";

function makeResult(
  overrides: Partial<ConversationResult> = {},
): ConversationResult {
  return {
    sessionId: "test-session",
    taskId: "pp_001",
    configName: "baseline",
    trialNumber: 1,
    messages: [
      {
        role: "assistant",
        content: "Can you provide your name and order ID for verification?",
        timestamp: new Date().toISOString(),
      },
      {
        role: "user",
        content: "My name is Jane, order 12345",
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: "Your order status is confirmed. Is there anything else?",
        timestamp: new Date().toISOString(),
      },
    ],
    turnCount: 3,
    toolCallLog: [
      {
        turn: 2,
        toolName: "pizzapalace_get_order",
        arguments: { orderId: "12345" },
        result: { success: true, data: { status: "confirmed" } },
        approved: true,
        latencyMs: 150,
      },
    ],
    verifierLog: [],
    status: "completed",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    tokenUsage: {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
    },
    ...overrides,
  };
}

const simpleTask: TaskConfig = {
  task_id: "pp_001",
  title: "Simple Order Lookup",
  difficulty: "easy",
  tags: ["order"],
  user: {
    persona: "polite-straightforward",
    intent: "Check order status",
    hidden_context: { order_id: "12345" },
  },
  expected: {
    action_sequence: ["pizzapalace_get_order"],
    must: ["Agent asks for identity verification before lookup"],
    must_not: ["Agent shares other customer data"],
    outcome: "resolved",
  },
  verifier_expected: {
    should_trigger: [],
    should_not_trigger: ["refund-amount-limit"],
  },
};

describe("Evaluator", () => {
  const evaluator = new Evaluator();

  test("evaluates successful task", () => {
    const result = makeResult();
    const evaluation = evaluator.evaluate(result, simpleTask);

    expect(evaluation.taskId).toBe("pp_001");
    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.length).toBeGreaterThan(0);
  });

  test("detects failed action_sequence", () => {
    const result = makeResult({
      toolCallLog: [], // No tools called
    });

    const evaluation = evaluator.evaluate(result, simpleTask);
    const seqCheck = evaluation.checks.find(
      (c) => c.type === "action_sequence",
    );
    expect(seqCheck?.passed).toBe(false);
  });

  test("checks outcome correctly", () => {
    // Completed (resolved)
    const result1 = makeResult({ status: "completed" });
    const eval1 = evaluator.evaluate(result1, simpleTask);
    const outcomeCheck1 = eval1.checks.find((c) => c.type === "outcome");
    expect(outcomeCheck1?.passed).toBe(true);

    // Error (should fail for "resolved" expectation)
    const result2 = makeResult({ status: "error" });
    const eval2 = evaluator.evaluate(result2, simpleTask);
    const outcomeCheck2 = eval2.checks.find((c) => c.type === "outcome");
    expect(outcomeCheck2?.passed).toBe(false);
  });

  test("checks escalation outcome", () => {
    const escalationTask: TaskConfig = {
      ...simpleTask,
      expected: { ...simpleTask.expected, outcome: "escalated" },
    };

    const result = makeResult({
      messages: [
        {
          role: "assistant",
          content: "I need to escalate this to a supervisor.",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const evaluation = evaluator.evaluate(result, escalationTask);
    const outcomeCheck = evaluation.checks.find((c) => c.type === "outcome");
    expect(outcomeCheck?.passed).toBe(true);
  });

  test("checks verifier_expected correctly", () => {
    const result = makeResult({
      verifierLog: [
        {
          turn: 1,
          ruleId: "refund-amount-limit",
          passed: false,
          action: "escalate",
          message: "Too high",
        },
      ],
    });

    const evaluation = evaluator.evaluate(result, simpleTask);
    const verifierCheck = evaluation.checks.find(
      (c) =>
        c.type === "verifier_trigger" &&
        c.description.includes("refund-amount-limit") &&
        c.description.includes("should NOT"),
    );
    // refund-amount-limit should NOT trigger, but it did
    expect(verifierCheck?.passed).toBe(false);
  });

  test("computes task metrics", () => {
    const result = makeResult();
    const evaluation = evaluator.evaluate(result, simpleTask);

    expect(evaluation.metrics.turn_count).toBe(3);
    expect(evaluation.metrics.total_tool_calls).toBe(1);
    expect(evaluation.metrics.approved_tool_calls).toBe(1);
    expect(evaluation.metrics.rejected_tool_calls).toBe(0);
    expect(evaluation.metrics.total_tokens).toBe(700);
  });
});

describe("Aggregate Metrics", () => {
  test("computes task_success_rate", () => {
    const evaluations: TaskEvaluation[] = [
      {
        taskId: "t1",
        configName: "a",
        trialNumber: 1,
        passed: true,
        checks: [],
        metrics: {},
      },
      {
        taskId: "t2",
        configName: "a",
        trialNumber: 1,
        passed: false,
        checks: [],
        metrics: {},
      },
      {
        taskId: "t3",
        configName: "a",
        trialNumber: 1,
        passed: true,
        checks: [],
        metrics: {},
      },
    ];

    const metrics = computeAggregateMetrics(evaluations, ["task_success_rate"]);
    expect(metrics.task_success_rate).toBeCloseTo(2 / 3);
  });

  test("computes verifier_intervention_rate", () => {
    const evaluations: TaskEvaluation[] = [
      {
        taskId: "t1",
        configName: "a",
        trialNumber: 1,
        passed: true,
        checks: [],
        metrics: {
          total_tool_calls: 5,
          rejected_tool_calls: 2,
        },
      },
      {
        taskId: "t2",
        configName: "a",
        trialNumber: 1,
        passed: true,
        checks: [],
        metrics: {
          total_tool_calls: 3,
          rejected_tool_calls: 1,
        },
      },
    ];

    const metrics = computeAggregateMetrics(evaluations, [
      "verifier_intervention_rate",
    ]);
    expect(metrics.verifier_intervention_rate).toBeCloseTo(3 / 8);
  });

  test("computes mean_turns_to_resolution", () => {
    const evaluations: TaskEvaluation[] = [
      {
        taskId: "t1",
        configName: "a",
        trialNumber: 1,
        passed: true,
        checks: [],
        metrics: { turn_count: 5 },
      },
      {
        taskId: "t2",
        configName: "a",
        trialNumber: 1,
        passed: true,
        checks: [],
        metrics: { turn_count: 10 },
      },
    ];

    const metrics = computeAggregateMetrics(evaluations, [
      "mean_turns_to_resolution",
    ]);
    expect(metrics.mean_turns_to_resolution).toBe(7.5);
  });

  test("computes pass_at_k", () => {
    const evaluations: TaskEvaluation[] = [
      // t1: trial 1 fails, trial 2 passes → pass@k = true
      {
        taskId: "t1",
        configName: "a",
        trialNumber: 1,
        passed: false,
        checks: [],
        metrics: {},
      },
      {
        taskId: "t1",
        configName: "a",
        trialNumber: 2,
        passed: true,
        checks: [],
        metrics: {},
      },
      // t2: both trials fail → pass@k = false
      {
        taskId: "t2",
        configName: "a",
        trialNumber: 1,
        passed: false,
        checks: [],
        metrics: {},
      },
      {
        taskId: "t2",
        configName: "a",
        trialNumber: 2,
        passed: false,
        checks: [],
        metrics: {},
      },
    ];

    const metrics = computeAggregateMetrics(evaluations, ["pass_at_k"]);
    expect(metrics.pass_at_k).toBe(0.5); // 1 of 2 tasks passed
  });
});
