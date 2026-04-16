/**
 * Integration test: multiple evaluator types against one test case — all pass.
 *
 * Scenario: a customer asks for their order status. The agent calls
 * `look_up_order` with the correct order ID, then replies with the status.
 *
 * Assertions on this single turn:
 *   1. tool_called          — look_up_order was called                (no API key)
 *   2. tool_input_contains  — order_id field equals "ORD-123"         (no API key)
 *   3. llm_judge            — agent looked up and reported the status (EVAL_LLM_API_KEY)
 *
 * The llm_judge assertion uses Anthropic (claude-haiku) when ANTHROPIC_API_KEY
 * is set. The whole test is skipped when the key is absent so CI without the
 * key still passes.
 *
 * Timeout: 30 s (single LLM call via Haiku is fast).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { env } from "@/env";
import type { SessionMessage } from "@db/schema";
import { executeAssertions } from "@features/evals/evals.service";
import type { Assertion, ResolvedAssertion } from "@features/evals/evals.types";

// ============================================================================
// Guard
// ============================================================================

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// ============================================================================
// Constants
// ============================================================================

const EVAL_RUN_ID = "00000000-0000-0000-0000-000000000001";
const ORG_ID = "00000000-0000-0000-0000-000000000002";
const CONFIG_ID = "00000000-0000-0000-0000-000000000003";
const TOOL_ID = "00000000-0000-0000-0000-000000000004";
const TOOL_NAME = "look_up_order";

// ============================================================================
// Configure LLM judge to use Anthropic/Haiku for this test suite
// ============================================================================

let originalApiKey: string | undefined;
let originalBaseUrl: string | undefined;
let originalModel: string | undefined;

beforeAll(() => {
  originalApiKey = env.EVAL_LLM_API_KEY;
  originalBaseUrl = env.EVAL_LLM_BASE_URL;
  originalModel = env.EVAL_LLM_MODEL;

  env.EVAL_LLM_API_KEY = process.env.ANTHROPIC_API_KEY;
  env.EVAL_LLM_BASE_URL = "https://api.anthropic.com";
  env.EVAL_LLM_MODEL = "claude-haiku-4-5-20251001";
});

afterAll(() => {
  env.EVAL_LLM_API_KEY = originalApiKey;
  env.EVAL_LLM_BASE_URL = originalBaseUrl;
  env.EVAL_LLM_MODEL = originalModel;
});

// ============================================================================
// Message helpers
// ============================================================================

function makeTextMessage(
  role: "user" | "assistant",
  content: string,
): SessionMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: "sess-multi-eval",
    role,
    content,
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
  } as SessionMessage;
}

function makeToolMessage(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: Record<string, unknown>,
): SessionMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: "sess-multi-eval",
    role: "tool",
    content: null,
    audioUrl: null,
    audioDurationMs: null,
    toolCallId: `call-${toolName}`,
    toolName,
    toolInput,
    toolOutput,
    toolStatus: "success",
    modelUsed: null,
    tokensUsed: null,
    latencyMs: null,
    occurredAt: new Date(),
    createdAt: new Date(),
  } as SessionMessage;
}

// ============================================================================
// Assertion helpers
// ============================================================================

function toolCalledAssertion(order: number): ResolvedAssertion {
  return {
    order,
    name: `tool_called:${TOOL_NAME}:${order}`,
    required: true,
    evaluator: {
      configId: CONFIG_ID,
      evaluatorType: "tool_called",
      config: { connectorToolId: TOOL_ID },
    },
    toolNameMap: { [TOOL_ID]: TOOL_NAME },
  };
}

function toolInputContainsAssertion(
  order: number,
  assertions: Record<string, Assertion>,
): ResolvedAssertion {
  return {
    order,
    name: `tool_input_contains:${TOOL_NAME}:${order}`,
    required: true,
    evaluator: {
      configId: CONFIG_ID,
      evaluatorType: "tool_input_contains",
      config: { connectorToolId: TOOL_ID, assertions },
    },
    toolNameMap: { [TOOL_ID]: TOOL_NAME },
  };
}

function llmJudgeAssertion(
  order: number,
  criterion: string,
): ResolvedAssertion {
  return {
    order,
    name: `llm_judge:${order}`,
    required: true,
    evaluator: {
      configId: CONFIG_ID,
      evaluatorType: "llm_judge",
      config: { criterion },
    },
    toolNameMap: {},
  };
}

// ============================================================================
// Test
// ============================================================================

describe("executeAssertions — multiple evaluator types, single test case", () => {
  it.skipIf(!HAS_API_KEY)(
    "tool_called + tool_input_contains + llm_judge all pass on a single turn",
    async () => {
      // Represent a single conversation turn:
      //   customer asks for order status → agent calls look_up_order(order_id=ORD-123)
      //   → receives order details → replies with status
      const messages: SessionMessage[] = [
        makeTextMessage("user", "Hi, where is my order ORD-123?"),
        makeTextMessage("assistant", "Let me look that up for you."),
        makeToolMessage(
          TOOL_NAME,
          { order_id: "ORD-123" },
          {
            status: "shipped",
            estimated_delivery: "2026-04-20",
            carrier: "FedEx",
          },
        ),
        makeTextMessage(
          "assistant",
          "Your order ORD-123 has been shipped and is estimated to arrive on April 20th, 2026 via FedEx.",
        ),
      ];

      const assertions: ResolvedAssertion[] = [
        // 1. Structural: was the tool called at all?
        toolCalledAssertion(1),

        // 2. Structural: was it called with the correct order ID?
        toolInputContainsAssertion(2, {
          order_id: { op: "equals", value: "ORD-123" },
        }),

        // 3. Semantic: did the agent look up the order and report the status?
        llmJudgeAssertion(
          3,
          "The agent looked up the customer's order using a tool call and reported the order status in its reply.",
        ),
      ];

      const { scoreRows } = await executeAssertions(
        assertions,
        messages,
        EVAL_RUN_ID,
        ORG_ID,
      );

      expect(scoreRows).toHaveLength(3);

      for (const row of scoreRows) {
        expect(
          row.result,
          `Assertion order=${row.scoreOrder} (${row.evaluatorType}) returned "${row.result}": ${row.reasoning}`,
        ).toBe("pass");
      }

      // Verify score order is stamped correctly
      expect(scoreRows.map((r) => r.scoreOrder)).toEqual([1, 2, 3]);
    },
    30_000,
  );
});
