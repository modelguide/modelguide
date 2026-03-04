/**
 * End-to-end evaluation scenario tests.
 *
 * Each scenario exercises the full lifecycle:
 *   eval configs → SOP with evalConfigId → session + messages → eval run → scores
 *
 * Scenarios:
 *   S1: Happy path — realistic 4-step SOP (skip, tool_called, tool_input, llm_judge)
 *   S2: Required step fails → short-circuit remaining steps
 *   S3: tool_input_contains — wrong arguments
 *   S4: evalConfigId lifecycle — SOP CRUD round-trip + delete guard
 *   S5: Optional fail does not affect verdict
 *   S6: List and filter runs across scenarios
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import {
  connectorTools,
  connectors,
  evalConfigs,
  evalRunScores,
  evalRuns,
  sessions,
  sops,
} from "@db/schema";
import type { Server } from "bun";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";
import { overrideEnv, restoreEnv } from "../helpers/test-env";

// ============================================================================
// Setup
// ============================================================================

let s: TestSeed;
let adminHeaders: Record<string, string>;
let agentHeaders: Record<string, string>;

/** Resolved connector tool info from seed data */
let getOrderToolId: string;
let getOrderToolName: string; // e.g. glowbox_store_get_order
let addToCartToolId: string;
let addToCartToolName: string; // e.g. glowbox_store_add_to_cart

/** Cleanup tracking */
const cleanupSessionIds: string[] = [];
const cleanupSopIds: string[] = [];
const cleanupConfigIds: string[] = [];
const cleanupRunIds: string[] = [];

function req(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

function post(path: string, headers: Record<string, string>, body: unknown) {
  return req(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Create a session, add messages, complete it. Returns session ID. */
async function buildSession(
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    toolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolOutput?: Record<string, unknown>;
      toolStatus?: "success" | "error";
    }>;
  }>,
): Promise<string> {
  const res = await post("/api/sessions", agentHeaders, {
    channelType: "web",
    userIdentifier: `e2e-${Date.now()}@test.com`,
  });
  const session = await res.json();
  cleanupSessionIds.push(session.id);

  for (const msg of messages) {
    await post(`/api/sessions/${session.id}/messages`, agentHeaders, msg);
  }

  await req(`/api/sessions/${session.id}`, {
    method: "PATCH",
    headers: agentHeaders,
    body: JSON.stringify({ status: "completed" }),
  });

  return session.id;
}

beforeAll(async () => {
  s = await getTestSeed();
  [adminHeaders, agentHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
  ]);

  // Resolve connector tools for orgA's Medusa connector
  const toolRows = await forApp(async (tx) =>
    tx
      .select({
        id: connectorTools.id,
        toolSlug: connectorTools.slug,
        connectorSlug: connectors.slug,
      })
      .from(connectorTools)
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .where(
        and(
          eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
          isNull(connectorTools.deletedAt),
        ),
      ),
  );

  const getOrder = toolRows.find((t) => t.toolSlug === "get_order")!;
  getOrderToolId = getOrder.id;
  getOrderToolName = `${getOrder.connectorSlug}_${getOrder.toolSlug}`;

  const addToCart = toolRows.find((t) => t.toolSlug === "add_to_cart")!;
  addToCartToolId = addToCart.id;
  addToCartToolName = `${addToCart.connectorSlug}_${addToCart.toolSlug}`;
});

afterAll(async () => {
  await forApp(async (tx) => {
    if (cleanupRunIds.length > 0) {
      await tx
        .delete(evalRunScores)
        .where(inArray(evalRunScores.evalRunId, cleanupRunIds));
      await tx.delete(evalRuns).where(inArray(evalRuns.id, cleanupRunIds));
    }
    for (const id of cleanupSessionIds) {
      await tx.delete(sessions).where(eq(sessions.id, id));
    }
    if (cleanupSopIds.length > 0) {
      await tx.delete(sops).where(inArray(sops.id, cleanupSopIds));
    }
    if (cleanupConfigIds.length > 0) {
      await tx
        .delete(evalConfigs)
        .where(inArray(evalConfigs.id, cleanupConfigIds));
    }
  });
});

// ============================================================================
// Mock LLM server for llm_judge evaluator
// ============================================================================

/** Canned Anthropic Messages API response */
function anthropicResponse(verdict: "pass" | "fail", reasoning: string) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: JSON.stringify({ verdict, reasoning }),
      },
    ],
    model: "mock-model",
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

let mockLlmServer: Server | null = null;

function startMockLlm(verdict: "pass" | "fail", reasoning: string) {
  mockLlmServer = Bun.serve({
    port: 0, // random available port
    fetch() {
      return new Response(
        JSON.stringify(anthropicResponse(verdict, reasoning)),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  overrideEnv("EVAL_LLM_API_KEY", "mock-key");
  overrideEnv("EVAL_LLM_BASE_URL", `http://localhost:${mockLlmServer.port}`);
  overrideEnv("EVAL_LLM_MODEL", "mock-model");
}

function stopMockLlm() {
  if (mockLlmServer) {
    mockLlmServer.stop(true);
    mockLlmServer = null;
  }
  restoreEnv();
}

// ============================================================================
// Scenario 1: Happy path — realistic 4-step SOP
//
// SOP "Order Lookup":
//   1. Greet the customer (no eval → skip)
//   2. Look up order with get_order (tool_called → pass)
//   3. Verify orderId was provided (tool_input_contains → pass)
//   4. Confirm order status was communicated (llm_judge → pass via mock)
//
// Session: agent greets, calls get_order({orderId:"ORD-42"}), tells status
// Expected: 4 scores [skip, pass, pass, pass], passed = true
// ============================================================================

describe("Scenario 1: happy path — 4-step Order Lookup SOP", () => {
  let sopId: string;
  let toolCalledCfgId: string;
  let inputCfgId: string;
  let llmJudgeCfgId: string;
  let runId: string;

  test("1a. create eval configs for all three evaluator types", async () => {
    const r1 = await post("/api/eval-configs", adminHeaders, {
      name: "Order Lookup: get_order called",
      evaluatorType: "tool_called",
      config: { connectorToolId: getOrderToolId },
    });
    expect(r1.status).toBe(201);
    toolCalledCfgId = (await r1.json()).id;
    cleanupConfigIds.push(toolCalledCfgId);

    const r2 = await post("/api/eval-configs", adminHeaders, {
      name: "Order Lookup: orderId provided",
      evaluatorType: "tool_input_contains",
      config: {
        connectorToolId: getOrderToolId,
        assertions: {
          orderId: { op: "exists" },
        },
      },
    });
    expect(r2.status).toBe(201);
    inputCfgId = (await r2.json()).id;
    cleanupConfigIds.push(inputCfgId);

    const r3 = await post("/api/eval-configs", adminHeaders, {
      name: "Order Lookup: status communicated",
      evaluatorType: "llm_judge",
      config: {
        criterion:
          "The agent told the customer their order status after looking it up",
        rubric: {
          pass: "Agent clearly stated the order status (e.g. shipped, delivered, processing)",
          fail: "Agent did not communicate the order status to the customer",
        },
      },
    });
    expect(r3.status).toBe(201);
    llmJudgeCfgId = (await r3.json()).id;
    cleanupConfigIds.push(llmJudgeCfgId);
  });

  test("1b. create SOP with 4 steps (1 no-eval, 3 with evalConfigId)", async () => {
    const r = await post("/api/sops", adminHeaders, {
      name: "E2E Order Lookup Test",
      description: "Standard order status inquiry procedure",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "greet",
            order: 1,
            instruction: "Greet the customer warmly",
            required: true,
          },
          {
            id: "lookup-order",
            order: 2,
            instruction:
              "Look up the customer's order using the get_order tool",
            required: true,
            tool: { connectorToolId: getOrderToolId },
            evalConfigId: toolCalledCfgId,
          },
          {
            id: "verify-input",
            order: 3,
            instruction: "Ensure orderId was passed to the tool",
            required: true,
            evalConfigId: inputCfgId,
          },
          {
            id: "communicate-status",
            order: 4,
            instruction:
              "Tell the customer their order status clearly and concisely",
            required: true,
            evalConfigId: llmJudgeCfgId,
          },
        ],
        metadata: {},
      },
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    sopId = body.id;
    cleanupSopIds.push(sopId);
  });

  test("1c. GET SOP returns evalConfigId on correct steps", async () => {
    const r = await req(`/api/sops/${sopId}`, { headers: adminHeaders });
    expect(r.status).toBe(200);
    const body = await r.json();
    const steps = body.definition.steps;

    expect(steps).toHaveLength(4);
    expect(steps[0].evalConfigId).toBeUndefined();
    expect(steps[1].evalConfigId).toBe(toolCalledCfgId);
    expect(steps[2].evalConfigId).toBe(inputCfgId);
    expect(steps[3].evalConfigId).toBe(llmJudgeCfgId);
  });

  test("1d. run eval on session with correct tool call → all pass", async () => {
    startMockLlm(
      "pass",
      "Agent clearly communicated the order status to the customer",
    );
    const sessionId = await buildSession([
      { role: "user", content: "Hi, can you check on my order ORD-42?" },
      {
        role: "assistant",
        content: "Of course! Let me look that up for you right away.",
        toolCalls: [
          {
            toolCallId: "tc-order",
            toolName: getOrderToolName,
            toolInput: { orderId: "ORD-42" },
            toolOutput: {
              orderId: "ORD-42",
              status: "shipped",
              carrier: "FedEx",
              trackingNumber: "FX123456",
            },
            toolStatus: "success",
          },
        ],
      },
      {
        role: "assistant",
        content:
          "Great news! Your order ORD-42 has been shipped via FedEx. Your tracking number is FX123456.",
      },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    runId = body.id;
    cleanupRunIds.push(runId);

    // Overall verdict
    expect(body.status).toBe("completed");
    expect(body.passed).toBe(true);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.triggeredBy).toBe(s.orgAAdmin.id);
    expect(body.completedAt).toBeDefined();

    // 3 scores — step 1 (greet) has no eval config → no score row
    expect(body.scores).toHaveLength(3);

    // Step 2: tool_called → pass
    const s2 = body.scores[0];
    expect(s2.scoreOrder).toBe(2);
    expect(s2.result).toBe("pass");
    expect(s2.evaluatorType).toBe("tool_called");
    expect(s2.evalConfigId).toBe(toolCalledCfgId);
    expect(s2.durationMs).toBeGreaterThanOrEqual(0);

    // Step 3: tool_input_contains → pass (orderId exists)
    const s3 = body.scores[1];
    expect(s3.scoreOrder).toBe(3);
    expect(s3.result).toBe("pass");
    expect(s3.evaluatorType).toBe("tool_input_contains");
    expect(s3.evalConfigId).toBe(inputCfgId);
    expect(s3.expected).toHaveProperty("orderId");
    expect(s3.actual).toHaveProperty("orderId");

    // Step 4: llm_judge → pass (via mock)
    const s4 = body.scores[2];
    expect(s4.scoreOrder).toBe(4);
    expect(s4.result).toBe("pass");
    expect(s4.evaluatorType).toBe("llm_judge");
    expect(s4.evalConfigId).toBe(llmJudgeCfgId);
    expect(s4.reasoning).toContain("communicated");
    expect(s4.expected).toHaveProperty("criterion");
    expect(s4.actual).toHaveProperty("verdict");

    stopMockLlm();
  });

  test("1e. GET run by ID returns sourceName, scores, and coverage warning", async () => {
    const r = await req(`/api/evals/runs/${runId}`, { headers: adminHeaders });
    expect(r.status).toBe(200);
    const body = await r.json();

    expect(body.sourceName).toBe("E2E Order Lookup Test");
    expect(body.scores).toHaveLength(3);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.completedAt).toBeDefined();

    // Coverage warning: step 1 (greet) has no eval config
    expect(body.metadata).toBeDefined();
    expect(body.metadata.coverageWarning).toContain("1 of 4");
    expect(body.metadata.uncoveredSteps).toContain("greet");
  });

  // --------------------------------------------------------------------------
  // 1f. Unhappy: agent used the wrong tool instead of get_order
  //
  // Real scenario: customer asks "where's my order?", agent calls
  // add_to_cart instead of get_order (confused tool selection), then
  // fabricates a tracking number. tool_called fails → short-circuit.
  // --------------------------------------------------------------------------

  test("1f. agent called wrong tool instead of get_order → fail + short-circuit", async () => {
    const sessionId = await buildSession([
      { role: "user", content: "Where's my order ORD-42?" },
      {
        role: "assistant",
        content: "Let me check that for you.",
        toolCalls: [
          {
            toolCallId: "tc-wrong-tool",
            toolName: addToCartToolName,
            toolInput: { productId: "ORD-42", quantity: 1 },
            toolOutput: { error: "invalid product" },
            toolStatus: "error",
          },
        ],
      },
      {
        role: "assistant",
        content:
          "Your order ORD-42 was shipped yesterday with FedEx tracking number FX999999. It should arrive by Friday!",
      },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    cleanupRunIds.push(body.id);

    expect(body.passed).toBe(false);
    // Step 1 (greet, no eval) → no score row. Steps 2-4 all have eval configs.
    expect(body.scores).toHaveLength(3);

    // Step 2: tool_called get_order → fail (agent called wrong tool)
    expect(body.scores[0].result).toBe("fail");
    expect(body.scores[0].evaluatorType).toBe("tool_called");
    expect(body.scores[0].failureClassification).toBe("tool_not_called");

    // Steps 3+4: short-circuited because required step 2 failed
    expect(body.scores[1].result).toBe("skip");
    expect(body.scores[1].reasoning).toContain("required step");
    expect(body.scores[2].result).toBe("skip");
    expect(body.scores[2].reasoning).toContain("required step");
  });

  // --------------------------------------------------------------------------
  // 1g. Unhappy: agent called tools correctly but fumbled communication
  //
  // Real scenario: agent dutifully calls get_order with the orderId, gets
  // back "shipped" status, but instead of telling the customer, says
  // "I'll escalate this and someone will follow up." The llm_judge catches
  // that the order status was never communicated.
  // --------------------------------------------------------------------------

  test("1g. agent called tools correctly but gave vague non-answer → llm_judge fail", async () => {
    startMockLlm(
      "fail",
      "Agent retrieved the order status but did not communicate it to the customer. Instead said they would 'follow up later'.",
    );

    const sessionId = await buildSession([
      { role: "user", content: "Can you check order ORD-42 for me?" },
      {
        role: "assistant",
        content: "Sure, let me look into that.",
        toolCalls: [
          {
            toolCallId: "tc-order-1g",
            toolName: getOrderToolName,
            toolInput: { orderId: "ORD-42" },
            toolOutput: {
              orderId: "ORD-42",
              status: "shipped",
              carrier: "FedEx",
              trackingNumber: "FX123456",
            },
            toolStatus: "success",
          },
        ],
      },
      {
        role: "assistant",
        content:
          "I've noted your inquiry. Someone from our team will follow up with you about this within 24 hours.",
      },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    cleanupRunIds.push(body.id);

    expect(body.passed).toBe(false);
    // Step 1 (greet, no eval) → no score row
    expect(body.scores).toHaveLength(3);

    // Steps 2-3: tool evals pass
    expect(body.scores[0].result).toBe("pass"); // tool_called ✓
    expect(body.scores[1].result).toBe("pass"); // tool_input orderId ✓

    // Step 4: llm_judge catches the bad communication
    const s4 = body.scores[2];
    expect(s4.result).toBe("fail");
    expect(s4.evaluatorType).toBe("llm_judge");
    expect(s4.reasoning).toContain("follow up");
    expect(s4.expected).toHaveProperty("criterion");
    expect(s4.actual).toHaveProperty("verdict");

    stopMockLlm();
  });
});

// ============================================================================
// Scenario 2: Required step fails → short-circuit
//
// SOP: step 1 (required, tool_called get_order), step 2 (required, tool_input)
// Session: agent calls add_to_cart instead of get_order
// Expected: step 1 fails → step 2 skipped → passed = false
// ============================================================================

describe("Scenario 2: required fail → short-circuit", () => {
  let sopId: string;

  test("2a. create configs and SOP", async () => {
    const r1 = await post("/api/eval-configs", adminHeaders, {
      name: "S2: get_order called",
      evaluatorType: "tool_called",
      config: { connectorToolId: getOrderToolId },
    });
    const cfg1Id = (await r1.json()).id;
    cleanupConfigIds.push(cfg1Id);

    const r2 = await post("/api/eval-configs", adminHeaders, {
      name: "S2: orderId present",
      evaluatorType: "tool_input_contains",
      config: {
        connectorToolId: getOrderToolId,
        assertions: { orderId: { op: "exists" } },
      },
    });
    const cfg2Id = (await r2.json()).id;
    cleanupConfigIds.push(cfg2Id);

    const r3 = await post("/api/sops", adminHeaders, {
      name: "S2: Short-circuit SOP",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "must-lookup",
            order: 1,
            instruction: "Must call get_order",
            required: true,
            evalConfigId: cfg1Id,
          },
          {
            id: "check-input",
            order: 2,
            instruction: "Verify orderId",
            required: true,
            evalConfigId: cfg2Id,
          },
        ],
        metadata: {},
      },
    });
    sopId = (await r3.json()).id;
    cleanupSopIds.push(sopId);
  });

  test("2b. agent calls wrong tool → required step fails, rest skipped", async () => {
    const sessionId = await buildSession([
      { role: "user", content: "Add this to my cart" },
      {
        role: "assistant",
        content: "Adding to cart.",
        toolCalls: [
          {
            toolCallId: "tc-wrong",
            toolName: addToCartToolName,
            toolInput: { productId: "prod-1", quantity: 1 },
            toolOutput: { success: true },
            toolStatus: "success",
          },
        ],
      },
      { role: "assistant", content: "Done!" },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    cleanupRunIds.push(body.id);

    expect(body.passed).toBe(false);
    expect(body.scores).toHaveLength(2);

    // Step 1: tool_called → fail (wrong tool)
    expect(body.scores[0].result).toBe("fail");
    expect(body.scores[0].evaluatorType).toBe("tool_called");
    expect(body.scores[0].failureClassification).toBe("tool_not_called");
    expect(body.scores[0].required).toBe(true);

    // Step 2: short-circuited → skip
    expect(body.scores[1].result).toBe("skip");
    expect(body.scores[1].reasoning).toContain("required step");
  });
});

// ============================================================================
// Scenario 3: tool_input_contains — wrong arguments
//
// SOP: add_to_cart with quantity > 0 and productId exists
// 3a: quantity: 0 → wrong_arguments
// 3b: quantity: 3 → pass (same SOP, different session)
// ============================================================================

describe("Scenario 3: tool_input_contains wrong arguments", () => {
  let sopId: string;

  test("3a. create config + SOP", async () => {
    const cfgRes = await post("/api/eval-configs", adminHeaders, {
      name: "S3: cart qty > 0",
      evaluatorType: "tool_input_contains",
      config: {
        connectorToolId: addToCartToolId,
        assertions: {
          quantity: { op: "gt", value: 0 },
          productId: { op: "exists" },
        },
      },
    });
    const cfgId = (await cfgRes.json()).id;
    cleanupConfigIds.push(cfgId);

    const sopRes = await post("/api/sops", adminHeaders, {
      name: "S3: Cart Validation SOP",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "add-cart",
            order: 1,
            instruction: "Add to cart with valid quantity",
            required: true,
            evalConfigId: cfgId,
          },
        ],
        metadata: {},
      },
    });
    sopId = (await sopRes.json()).id;
    cleanupSopIds.push(sopId);
  });

  test("3b. quantity: 0 → wrong_arguments, expected/actual populated", async () => {
    const sessionId = await buildSession([
      { role: "user", content: "Add product to cart" },
      {
        role: "assistant",
        content: "Adding.",
        toolCalls: [
          {
            toolCallId: "tc-bad",
            toolName: addToCartToolName,
            toolInput: { productId: "prod-1", quantity: 0 },
            toolOutput: { error: "invalid" },
            toolStatus: "error",
          },
        ],
      },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    cleanupRunIds.push(body.id);

    expect(body.passed).toBe(false);
    expect(body.scores[0].result).toBe("fail");
    expect(body.scores[0].failureClassification).toBe("wrong_arguments");
    expect(body.scores[0].expected).toHaveProperty("quantity");
    expect(body.scores[0].actual).toHaveProperty("quantity");
  });

  test("3c. same SOP, quantity: 3 → pass", async () => {
    const sessionId = await buildSession([
      { role: "user", content: "Add product to cart" },
      {
        role: "assistant",
        content: "Added!",
        toolCalls: [
          {
            toolCallId: "tc-good",
            toolName: addToCartToolName,
            toolInput: { productId: "prod-1", quantity: 3 },
            toolOutput: { success: true },
            toolStatus: "success",
          },
        ],
      },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    cleanupRunIds.push(body.id);

    expect(body.passed).toBe(true);
    expect(body.scores[0].result).toBe("pass");
  });
});

// ============================================================================
// Scenario 4: evalConfigId lifecycle — SOP CRUD round-trip + delete guard
// ============================================================================

describe("Scenario 4: evalConfigId lifecycle", () => {
  let cfgId: string;
  let sopId: string;

  test("4a. create config + SOP with evalConfigId", async () => {
    const cfgRes = await post("/api/eval-configs", adminHeaders, {
      name: "S4: lifecycle config",
      evaluatorType: "tool_called",
      config: { connectorToolId: getOrderToolId },
    });
    cfgId = (await cfgRes.json()).id;
    cleanupConfigIds.push(cfgId);

    const sopRes = await post("/api/sops", adminHeaders, {
      name: "S4: Lifecycle SOP",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "s1",
            order: 1,
            instruction: "Step with eval config",
            required: true,
            evalConfigId: cfgId,
          },
          {
            id: "s2",
            order: 2,
            instruction: "Step without eval config",
            required: false,
          },
        ],
        metadata: {},
      },
    });
    expect(sopRes.status).toBe(201);
    sopId = (await sopRes.json()).id;
    cleanupSopIds.push(sopId);
  });

  test("4b. GET SOP returns evalConfigId on correct steps", async () => {
    const r = await req(`/api/sops/${sopId}`, { headers: adminHeaders });
    const body = await r.json();
    const steps = body.definition.steps;

    expect(steps[0].evalConfigId).toBe(cfgId);
    expect(steps[1].evalConfigId).toBeUndefined();
  });

  test("4c. PATCH SOP — move evalConfigId between steps", async () => {
    const r = await req(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "s1",
              order: 1,
              instruction: "No config now",
              required: true,
            },
            {
              id: "s2",
              order: 2,
              instruction: "Has config now",
              required: false,
              evalConfigId: cfgId,
            },
          ],
          metadata: {},
        },
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();

    expect(body.definition.steps[0].evalConfigId).toBeUndefined();
    expect(body.definition.steps[1].evalConfigId).toBe(cfgId);
  });

  test("4d. cannot delete config while SOP references it (409)", async () => {
    const r = await req(`/api/eval-configs/${cfgId}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(r.status).toBe(409);
  });

  test("4e. remove evalConfigId from SOP, then delete config (204)", async () => {
    await req(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            { id: "s1", order: 1, instruction: "No config", required: true },
          ],
          metadata: {},
        },
      }),
    });

    const r = await req(`/api/eval-configs/${cfgId}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(r.status).toBe(204);

    // Already deleted — remove from cleanup
    const idx = cleanupConfigIds.indexOf(cfgId);
    if (idx !== -1) cleanupConfigIds.splice(idx, 1);
  });
});

// ============================================================================
// Scenario 5: Optional fail does not affect verdict
//
// SOP: step 1 (required, tool_called → pass)
//      step 2 (optional, tool_input_contains → fail — wrong qty)
//      step 3 (required, tool_input_contains → pass — orderId exists)
// Expected: passed = true (only required steps count)
// ============================================================================

describe("Scenario 5: optional fail does not affect verdict", () => {
  test("5a. optional step fails but run still passes", async () => {
    // Config 1: tool_called get_order (required, will pass)
    const cfg1Res = await post("/api/eval-configs", adminHeaders, {
      name: "S5: get_order called",
      evaluatorType: "tool_called",
      config: { connectorToolId: getOrderToolId },
    });
    const cfg1Id = (await cfg1Res.json()).id;
    cleanupConfigIds.push(cfg1Id);

    // Config 2: tool_input quantity > 100 (optional, will fail)
    const cfg2Res = await post("/api/eval-configs", adminHeaders, {
      name: "S5: high quantity (optional)",
      evaluatorType: "tool_input_contains",
      config: {
        connectorToolId: getOrderToolId,
        assertions: { orderId: { op: "gt", value: 100 } },
      },
    });
    const cfg2Id = (await cfg2Res.json()).id;
    cleanupConfigIds.push(cfg2Id);

    // Config 3: tool_input orderId exists (required, will pass)
    const cfg3Res = await post("/api/eval-configs", adminHeaders, {
      name: "S5: orderId exists",
      evaluatorType: "tool_input_contains",
      config: {
        connectorToolId: getOrderToolId,
        assertions: { orderId: { op: "exists" } },
      },
    });
    const cfg3Id = (await cfg3Res.json()).id;
    cleanupConfigIds.push(cfg3Id);

    const sopRes = await post("/api/sops", adminHeaders, {
      name: "S5: Optional Fail SOP",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "call-tool",
            order: 1,
            instruction: "Call get_order",
            required: true,
            evalConfigId: cfg1Id,
          },
          {
            id: "high-qty",
            order: 2,
            instruction: "Optional: orderId > 100",
            required: false,
            evalConfigId: cfg2Id,
          },
          {
            id: "has-id",
            order: 3,
            instruction: "orderId must exist",
            required: true,
            evalConfigId: cfg3Id,
          },
        ],
        metadata: {},
      },
    });
    const sopId = (await sopRes.json()).id;
    cleanupSopIds.push(sopId);

    const sessionId = await buildSession([
      { role: "user", content: "Check order 42" },
      {
        role: "assistant",
        content: "Looking up.",
        toolCalls: [
          {
            toolCallId: "tc-5",
            toolName: getOrderToolName,
            toolInput: { orderId: "42" },
            toolOutput: { status: "delivered" },
            toolStatus: "success",
          },
        ],
      },
    ]);

    const r = await post("/api/evals/runs", adminHeaders, {
      sessionId,
      sourceType: "sop",
      sourceId: sopId,
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    cleanupRunIds.push(body.id);

    // Verdict: pass (only required steps matter)
    expect(body.passed).toBe(true);
    expect(body.scores).toHaveLength(3);

    expect(body.scores[0].result).toBe("pass");
    expect(body.scores[0].required).toBe(true);

    expect(body.scores[1].result).toBe("fail");
    expect(body.scores[1].required).toBe(false);
    expect(body.scores[1].failureClassification).toBe("wrong_arguments");

    expect(body.scores[2].result).toBe("pass");
    expect(body.scores[2].required).toBe(true);
  });
});

// ============================================================================
// Scenario 6: List and filter runs across scenarios
// ============================================================================

describe("Scenario 6: list and filter runs", () => {
  test("6a. filter by sourceId returns only matching runs", async () => {
    const targetSopId = cleanupSopIds[0];

    const r = await req(
      `/api/evals/runs?sourceId=${targetSopId}&page=1&pageSize=50`,
      { headers: adminHeaders },
    );
    expect(r.status).toBe(200);
    const body = await r.json();

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const run of body.data) {
      expect(run.sourceId).toBe(targetSopId);
    }
  });

  test("6b. filter by status=completed returns all scenario runs", async () => {
    const r = await req("/api/evals/runs?status=completed&page=1&pageSize=50", {
      headers: adminHeaders,
    });
    expect(r.status).toBe(200);
    const body = await r.json();

    expect(body.data.length).toBeGreaterThanOrEqual(cleanupRunIds.length);
    for (const run of body.data) {
      expect(run.status).toBe("completed");
    }
  });
});
