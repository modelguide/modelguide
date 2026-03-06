/**
 * Unit tests for tool_called, tool_input_contains, no_tool_called evaluators.
 */

import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "@db/schema";
import type { StepEvaluatorConfig } from "@features/evals/evals.types";
import { getEvaluator } from "@features/evals/evaluators";
import type { EvalContext } from "@features/evals/evaluators/evaluator.types";
import { noToolCalledEvaluator } from "@features/evals/evaluators/no-tool-called";
import { toolCalledEvaluator } from "@features/evals/evaluators/tool-called";
import { toolInputEvaluator } from "@features/evals/evaluators/tool-input";

// ============================================================================
// Helpers
// ============================================================================

function makeToolMessage(
  toolName: string,
  toolInput?: Record<string, unknown>,
): SessionMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: "sess-1",
    organizationId: "org-1",
    role: "tool",
    content: null,
    toolCallId: `call-${toolName}`,
    toolName,
    toolInput: toolInput ?? {},
    toolOutput: { result: "ok" },
    toolStatus: "success",
    occurredAt: new Date(),
    createdAt: new Date(),
    tokens: null,
    costUsd: null,
    durationMs: null,
    model: null,
  };
}

function makeContext(
  toolMessages: SessionMessage[],
  resolvedToolNames: Map<string, string>,
): EvalContext {
  return {
    messages: toolMessages,
    toolMessages,
    resolvedToolNames,
  };
}

// ============================================================================
// Evaluator registry
// ============================================================================

describe("getEvaluator", () => {
  test("returns tool_called evaluator", () => {
    const e = getEvaluator("tool_called");
    expect(e.type).toBe("tool_called");
  });

  test("returns tool_input_contains evaluator", () => {
    const e = getEvaluator("tool_input_contains");
    expect(e.type).toBe("tool_input_contains");
  });

  test("returns no_tool_called evaluator", () => {
    const e = getEvaluator("no_tool_called");
    expect(e.type).toBe("no_tool_called");
  });

  test("returns llm_judge evaluator", () => {
    const e = getEvaluator("llm_judge");
    expect(e.type).toBe("llm_judge");
  });

  test("throws for unknown evaluator type", () => {
    expect(() => getEvaluator("nonexistent")).toThrow("Unknown evaluator type");
  });
});

// ============================================================================
// tool_called evaluator
// ============================================================================

describe("tool_called evaluator", () => {
  const config: StepEvaluatorConfig = {
    type: "tool_called",
    connectorToolId: "ct-1",
  };

  test("passes when tool was called", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart")],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("pass");
  });

  test("fails when tool was not called", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_search")],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.failureClassification).toBe("tool_not_called");
  });

  test("skips when no tool messages exist", async () => {
    const ctx = makeContext([], new Map([["ct-1", "store_add_to_cart"]]));
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("skip");
  });

  test("errors when connector tool ID cannot be resolved", async () => {
    const ctx = makeContext([makeToolMessage("store_search")], new Map());
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("error");
    expect(result.reasoning).toContain("Could not resolve");
  });

  test("errors on wrong config type", async () => {
    const ctx = makeContext([], new Map());
    const wrongConfig = {
      type: "no_tool_called",
      connectorToolId: "ct-1",
    } as StepEvaluatorConfig;
    const result = await toolCalledEvaluator.evaluate(ctx, wrongConfig);
    expect(result.result).toBe("error");
    expect(result.reasoning).toContain("Invalid config type");
  });

  test("includes durationMs in result", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart")],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe("number");
  });

  test("passes when target tool found among multiple different tool calls", async () => {
    const ctx = makeContext(
      [
        makeToolMessage("store_search"),
        makeToolMessage("store_add_to_cart"),
        makeToolMessage("store_get_order"),
      ],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("pass");
  });

  test("fails and lists other called tools in actual.calledTools", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_search"), makeToolMessage("store_get_order")],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.actual).toBeDefined();
    const actual = result.actual as { calledTools: string[] };
    expect(actual.calledTools).toContain("store_search");
    expect(actual.calledTools).toContain("store_get_order");
    expect(actual.calledTools).not.toContain("store_add_to_cart");
  });
});

// ============================================================================
// no_tool_called evaluator
// ============================================================================

describe("no_tool_called evaluator", () => {
  const config: StepEvaluatorConfig = {
    type: "no_tool_called",
    connectorToolId: "ct-ban",
  };

  test("passes when tool was not called", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_search")],
      new Map([["ct-ban", "store_delete_order"]]),
    );
    const result = await noToolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("pass");
  });

  test("passes when no tool messages at all", async () => {
    const ctx = makeContext([], new Map([["ct-ban", "store_delete_order"]]));
    const result = await noToolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("pass");
  });

  test("fails when banned tool was called", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_delete_order")],
      new Map([["ct-ban", "store_delete_order"]]),
    );
    const result = await noToolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.failureClassification).toBe("policy_violation");
  });

  test("errors when connector tool ID cannot be resolved", async () => {
    const ctx = makeContext([], new Map());
    const result = await noToolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("error");
  });

  test("fails when banned tool called multiple times — still policy_violation", async () => {
    const ctx = makeContext(
      [
        makeToolMessage("store_delete_order"),
        makeToolMessage("store_search"),
        makeToolMessage("store_delete_order"),
      ],
      new Map([["ct-ban", "store_delete_order"]]),
    );
    const result = await noToolCalledEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.failureClassification).toBe("policy_violation");
  });
});

// ============================================================================
// tool_input_contains evaluator
// ============================================================================

describe("tool_input_contains evaluator", () => {
  const config: StepEvaluatorConfig = {
    type: "tool_input_contains",
    connectorToolId: "ct-1",
    assertions: {
      quantity: { op: "gt", value: 0 },
      productId: { op: "exists" },
    },
  };

  test("passes when all assertions pass", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { quantity: 2, productId: "p-1" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("pass");
  });

  test("fails when assertion fails", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { quantity: 0, productId: "p-1" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.failureClassification).toBe("wrong_arguments");
  });

  test("fails when tool was not called", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_search")],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.failureClassification).toBe("tool_not_called");
  });

  test("skips when no tool messages exist", async () => {
    const ctx = makeContext([], new Map([["ct-1", "store_add_to_cart"]]));
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("skip");
  });

  test("errors when connector tool ID cannot be resolved", async () => {
    const ctx = makeContext([makeToolMessage("store_search")], new Map());
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("error");
  });

  test("fails when field is missing (exists assertion)", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { quantity: 5 })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.reasoning).toContain("productId");
  });

  test("includes expected and actual fields in result", async () => {
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { quantity: 2, productId: "p-1" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.expected).toBeDefined();
    expect(result.actual).toBeDefined();
  });

  test("handles equals assertion with type coercion", async () => {
    const coercionConfig: StepEvaluatorConfig = {
      type: "tool_input_contains",
      connectorToolId: "ct-1",
      assertions: {
        status: { op: "equals", value: "active" },
      },
    };
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { status: "active" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, coercionConfig);
    expect(result.result).toBe("pass");
  });

  test("handles contains assertion", async () => {
    const containsConfig: StepEvaluatorConfig = {
      type: "tool_input_contains",
      connectorToolId: "ct-1",
      assertions: {
        note: { op: "contains", value: "urgent" },
      },
    };
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { note: "This is urgent please" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, containsConfig);
    expect(result.result).toBe("pass");
  });

  test("handles matches assertion", async () => {
    const matchesConfig: StepEvaluatorConfig = {
      type: "tool_input_contains",
      connectorToolId: "ct-1",
      assertions: {
        email: { op: "matches", value: "^.+@.+$" },
      },
    };
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { email: "test@example.com" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, matchesConfig);
    expect(result.result).toBe("pass");
  });

  test("multiple assertions fail simultaneously — reasoning mentions all failing fields", async () => {
    const multiFailConfig: StepEvaluatorConfig = {
      type: "tool_input_contains",
      connectorToolId: "ct-1",
      assertions: {
        quantity: { op: "gt", value: 10 },
        status: { op: "equals", value: "active" },
      },
    };
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { quantity: 1, status: "draft" })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, multiFailConfig);
    expect(result.result).toBe("fail");
    expect(result.reasoning).toContain("quantity");
    expect(result.reasoning).toContain("status");
  });

  test("null toolInput on message → wrong_arguments", async () => {
    const msg = makeToolMessage("store_add_to_cart");
    msg.toolInput = null;
    const ctx = makeContext([msg], new Map([["ct-1", "store_add_to_cart"]]));
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("fail");
    expect(result.failureClassification).toBe("wrong_arguments");
  });

  test("empty assertions object → passes trivially", async () => {
    const emptyConfig: StepEvaluatorConfig = {
      type: "tool_input_contains",
      connectorToolId: "ct-1",
      assertions: {},
    };
    const ctx = makeContext(
      [makeToolMessage("store_add_to_cart", { quantity: 2 })],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, emptyConfig);
    expect(result.result).toBe("pass");
  });

  test("wrong config type → error", async () => {
    const ctx = makeContext([], new Map());
    const wrongConfig = {
      type: "tool_called",
      connectorToolId: "ct-1",
    } as StepEvaluatorConfig;
    const result = await toolInputEvaluator.evaluate(ctx, wrongConfig);
    expect(result.result).toBe("error");
    expect(result.reasoning).toContain("Invalid config type");
  });

  test("finds correct tool among multiple different tool calls", async () => {
    const ctx = makeContext(
      [
        makeToolMessage("store_search", { query: "shoes" }),
        makeToolMessage("store_add_to_cart", { quantity: 5, productId: "p-1" }),
        makeToolMessage("store_get_order", { orderId: "o-1" }),
      ],
      new Map([["ct-1", "store_add_to_cart"]]),
    );
    const result = await toolInputEvaluator.evaluate(ctx, config);
    expect(result.result).toBe("pass");
  });
});
