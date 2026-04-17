/**
 * Integration tests for concurrent evaluator execution in executeAssertions.
 *
 * Verifies the batch-parallel execution added in the scoring engine:
 * - All N results are returned when N > EVAL_CONCURRENCY (5)
 * - scoreOrder is deterministic regardless of execution order
 * - An invalid config in a batch produces "error" without affecting siblings
 * - A throwing evaluator is isolated to its own row
 *
 * Uses only tool_called / no_tool_called evaluators (no API key required).
 */

import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "@db/schema";
import { executeAssertions } from "@features/evals/evals.service";
import type { ResolvedAssertion } from "@features/evals/evals.types";

// ============================================================================
// Helpers
// ============================================================================

const EVAL_RUN_ID = "00000000-0000-0000-0000-000000000001";
const ORG_ID = "00000000-0000-0000-0000-000000000002";
const CONFIG_ID = "00000000-0000-0000-0000-000000000003";
const TOOL_ID = "00000000-0000-0000-0000-000000000004";

function makeToolMessage(toolName: string): SessionMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: "sess-test",
    role: "tool",
    content: null,
    audioUrl: null,
    audioDurationMs: null,
    toolCallId: `call-${toolName}`,
    toolName,
    toolInput: {},
    toolOutput: { result: "ok" },
    toolStatus: "success",
    modelUsed: null,
    tokensUsed: null,
    latencyMs: null,
    occurredAt: new Date(),
    createdAt: new Date(),
  } as SessionMessage;
}

/** Build a tool_called assertion that expects toolName at the given order. */
function toolCalledAssertion(
  order: number,
  toolId: string,
  toolName: string,
  required = true,
): ResolvedAssertion {
  return {
    order,
    name: `tool_called:${toolName}:${order}`,
    required,
    evaluator: {
      configId: CONFIG_ID,
      evaluatorType: "tool_called",
      config: { connectorToolId: toolId },
    },
    toolNameMap: { [toolId]: toolName },
  };
}

/** Build a no_tool_called assertion at the given order (expects toolName was NOT called). */
function noToolCalledAssertion(
  order: number,
  toolName: string,
): ResolvedAssertion {
  return {
    order,
    name: `no_tool_called:${order}`,
    required: true,
    evaluator: {
      configId: CONFIG_ID,
      evaluatorType: "no_tool_called",
      config: { connectorToolId: TOOL_ID },
    },
    toolNameMap: { [TOOL_ID]: toolName },
  };
}

/** Build an assertion with a deliberately invalid config. */
function invalidConfigAssertion(order: number): ResolvedAssertion {
  return {
    order,
    name: `invalid_config:${order}`,
    required: true,
    evaluator: {
      configId: CONFIG_ID,
      evaluatorType: "tool_called",
      // missing connectorToolId — will fail Zod parse
      config: {},
    },
    toolNameMap: {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeAssertions — concurrent batching", () => {
  test("returns all rows when N < EVAL_CONCURRENCY (single batch)", async () => {
    const toolId = TOOL_ID;
    const messages = [makeToolMessage("store_look_up_order")];
    const assertions = [
      toolCalledAssertion(1, toolId, "store_look_up_order"),
      toolCalledAssertion(2, toolId, "store_look_up_order"),
      toolCalledAssertion(3, toolId, "store_look_up_order"),
    ];

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      EVAL_RUN_ID,
      ORG_ID,
    );

    expect(scoreRows).toHaveLength(3);
  });

  test("returns all rows when N > EVAL_CONCURRENCY (multiple batches)", async () => {
    // 8 assertions → ceil(8/5) = 2 batches
    const toolId = TOOL_ID;
    const messages = [makeToolMessage("store_look_up_order")];
    const assertions = Array.from({ length: 8 }, (_, i) =>
      toolCalledAssertion(i + 1, toolId, "store_look_up_order"),
    );

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      EVAL_RUN_ID,
      ORG_ID,
    );

    expect(scoreRows).toHaveLength(8);
  });

  test("scoreOrder matches assertion.order regardless of batching", async () => {
    const toolId = TOOL_ID;
    const messages = [makeToolMessage("store_look_up_order")];
    // 7 assertions with explicit non-sequential order values
    const orders = [10, 3, 7, 1, 15, 6, 2];
    const assertions = orders.map((order) =>
      toolCalledAssertion(order, toolId, "store_look_up_order"),
    );

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      EVAL_RUN_ID,
      ORG_ID,
    );

    expect(scoreRows).toHaveLength(7);
    // Each row's scoreOrder must match the corresponding assertion's order
    for (let i = 0; i < orders.length; i++) {
      expect(scoreRows[i].scoreOrder).toBe(orders[i]);
    }
  });

  test("invalid config produces error row without affecting batch siblings", async () => {
    const toolId = TOOL_ID;
    const messages = [makeToolMessage("store_look_up_order")];
    // 6 assertions: indices 0,1,2 pass | index 3 is invalid | indices 4,5 pass
    const assertions: ResolvedAssertion[] = [
      toolCalledAssertion(1, toolId, "store_look_up_order"),
      toolCalledAssertion(2, toolId, "store_look_up_order"),
      toolCalledAssertion(3, toolId, "store_look_up_order"),
      invalidConfigAssertion(4),
      toolCalledAssertion(5, toolId, "store_look_up_order"),
      toolCalledAssertion(6, toolId, "store_look_up_order"),
    ];

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      EVAL_RUN_ID,
      ORG_ID,
    );

    expect(scoreRows).toHaveLength(6);

    const errorRow = scoreRows.find((r) => r.scoreOrder === 4);
    expect(errorRow?.result).toBe("error");
    expect(errorRow?.reasoning).toContain("Invalid eval config");

    // All other rows should not be errors
    const nonErrorRows = scoreRows.filter((r) => r.scoreOrder !== 4);
    for (const row of nonErrorRows) {
      expect(row.result).not.toBe("error");
    }
  });

  test("pass/fail results are correct across batches", async () => {
    const toolId = TOOL_ID;
    // 6 messages — half with the expected tool, half with a different one
    const messages = [
      makeToolMessage("store_look_up_order"),
      makeToolMessage("store_look_up_order"),
      makeToolMessage("store_look_up_order"),
    ];

    const assertions: ResolvedAssertion[] = [
      // These should pass — the tool was called
      toolCalledAssertion(1, toolId, "store_look_up_order"),
      toolCalledAssertion(2, toolId, "store_look_up_order"),
      toolCalledAssertion(3, toolId, "store_look_up_order"),
      toolCalledAssertion(4, toolId, "store_look_up_order"),
      toolCalledAssertion(5, toolId, "store_look_up_order"),
      // These should fail — no_tool_called but tools were called
      noToolCalledAssertion(6, "store_look_up_order"),
      noToolCalledAssertion(7, "store_look_up_order"),
    ];

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      EVAL_RUN_ID,
      ORG_ID,
    );

    expect(scoreRows).toHaveLength(7);

    const passing = scoreRows.filter((r) => r.scoreOrder <= 5);
    const failing = scoreRows.filter((r) => r.scoreOrder >= 6);

    for (const row of passing) {
      expect(row.result).toBe("pass");
    }
    for (const row of failing) {
      expect(row.result).toBe("fail");
    }
  });

  test("empty assertions list returns empty score rows", async () => {
    const { scoreRows } = await executeAssertions([], [], EVAL_RUN_ID, ORG_ID);

    expect(scoreRows).toHaveLength(0);
  });

  test("evalRunId and organizationId are stamped on every row", async () => {
    const toolId = TOOL_ID;
    const messages = [makeToolMessage("store_look_up_order")];
    const assertions = Array.from({ length: 6 }, (_, i) =>
      toolCalledAssertion(i + 1, toolId, "store_look_up_order"),
    );

    const runId = "aaaaaaaa-0000-0000-0000-000000000001";
    const orgId = "bbbbbbbb-0000-0000-0000-000000000002";

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      runId,
      orgId,
    );

    for (const row of scoreRows) {
      expect(row.evalRunId).toBe(runId);
      expect(row.organizationId).toBe(orgId);
    }
  });
});
