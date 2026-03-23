/**
 * Integration tests for POST /api/sessions/:id/classify
 *
 * Tests the manual SOP classification endpoint. The happy-path test
 * mocks globalThis.fetch to intercept the LLM call and requires
 * SOPs assigned to the agent.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agentSops, sessions, sopSteps, sops } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";
import { overrideEnv, restoreEnv } from "../helpers/test-env";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgAAgentHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;

const createdSessionIds: string[] = [];
let testSopId: string;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/** Build a mock OpenAI-compatible tool_call response for the classify_sop tool. */
function openAIToolResponse(input: Record<string, unknown>) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "classify_sop",
                arguments: JSON.stringify(input),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

const originalFetch = globalThis.fetch;

beforeAll(async () => {
  s = await getTestSeed();
  [orgAAdminHeaders, orgAAgentHeaders, orgBAdminHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
    authHeadersFor(s.orgBAdmin),
  ]);

  // Create an active SOP and assign it to orgA's agent
  await forApp(async (tx) => {
    const [sop] = await tx
      .insert(sops)
      .values({
        organizationId: s.orgA.id,
        slug: "test-order-lookup",
        name: "Test Order Lookup",
        description: "Help customers check order status",
        trigger: {
          type: "intent_detected",
          config: { patterns: ["order status", "where is my order"] },
        },
        metadata: {},
        status: "active",
      })
      .returning();
    testSopId = sop.id;

    await tx.insert(sopSteps).values({
      sopId: sop.id,
      stepId: "greet",
      order: 1,
      instruction: "Greet the customer and ask for their order number.",
    });

    await tx.insert(agentSops).values({
      agentId: s.orgAAgentId,
      sopId: sop.id,
    });
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

afterAll(async () => {
  // Clean up sessions (messages cascade-deleted via FK)
  if (createdSessionIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdSessionIds) {
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    });
  }
  // Clean up SOP + assignment
  if (testSopId) {
    await forApp(async (tx) => {
      await tx.delete(agentSops).where(eq(agentSops.sopId, testSopId));
      await tx.delete(sopSteps).where(eq(sopSteps.sopId, testSopId));
      await tx.delete(sops).where(eq(sops.id, testSopId));
    });
  }
});

// ============================================================================
// Helpers
// ============================================================================

/** Create a session via the API and track its ID for cleanup. */
async function createTestSession(
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const res = await request("/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      channelType: "voice",
      userIdentifier: `+1${Date.now()}`,
      ...overrides,
    }),
  });
  const body = await res.json();
  createdSessionIds.push(body.id);
  return body;
}

/** Add a user message to a session. */
async function addMessage(
  sessionId: string,
  headers: Record<string, string>,
  content: string,
) {
  await request(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role: "user", content }),
  });
}

/** Set sop_classification metadata directly in DB (simulate pre-classified). */
async function preClassifySession(sessionId: string) {
  await forApp(async (tx) => {
    await tx
      .update(sessions)
      .set({
        metadata: {
          sop_classification: {
            sop_slug: "test-order-lookup",
            sop_name: "Test Order Lookup",
            confidence: 0.95,
            unknown: false,
            source: "server",
          },
        },
      })
      .where(eq(sessions.id, sessionId));
  });
}

/** Mock globalThis.fetch to return a successful LLM classification. */
function mockLlmClassification(slug: string, confidence: number) {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          openAIToolResponse({
            sop_slug: slug,
            confidence,
            reasoning: "Test classification",
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  ) as unknown as typeof fetch;
}

// ============================================================================
// Tests
// ============================================================================

describe("POST /api/sessions/:id/classify", () => {
  test("classifies an unclassified session (200)", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");
    mockLlmClassification("test-order-lookup", 0.92);

    const session = await createTestSession(orgAAgentHeaders);
    await addMessage(session.id, orgAAgentHeaders, "Where is my order?");

    const response = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.sopClassification).toBeDefined();
    expect(body.sopClassification.sopSlug).toBe("test-order-lookup");
    expect(body.sopClassification.sopName).toBe("Test Order Lookup");
    expect(body.sopClassification.confidence).toBe(0.92);
    expect(body.sopClassification.source).toBe("server");
  });

  test("rejects already-classified session (409)", async () => {
    const session = await createTestSession(orgAAgentHeaders);
    await preClassifySession(session.id);

    const response = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("CONFLICT");
  });

  test("returns 400 when classification fails (no API key)", async () => {
    overrideEnv("EVAL_LLM_API_KEY", undefined);

    const session = await createTestSession(orgAAgentHeaders);
    await addMessage(session.id, orgAAgentHeaders, "Hello");

    const response = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}/classify`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("rejects unauthenticated request (401)", async () => {
    const session = await createTestSession(orgAAgentHeaders);

    const response = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  test("rejects agent auth — requires user auth (401)", async () => {
    const session = await createTestSession(orgAAgentHeaders);

    const response = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(401);
  });

  test("respects RLS — org B cannot classify org A session (404)", async () => {
    const session = await createTestSession(orgAAgentHeaders);

    const response = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("persists classification in session metadata", async () => {
    overrideEnv("EVAL_LLM_API_KEY", "test-key");
    overrideEnv("EVAL_LLM_BASE_URL", "http://localhost:9999");
    mockLlmClassification("test-order-lookup", 0.88);

    const session = await createTestSession(orgAAgentHeaders);
    await addMessage(session.id, orgAAgentHeaders, "I need to return an item");

    // Classify
    const classifyRes = await request(`/api/sessions/${session.id}/classify`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(classifyRes.status).toBe(200);

    // Verify via GET detail
    const detailRes = await request(`/api/sessions/${session.id}`, {
      headers: orgAAdminHeaders,
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();

    expect(detail.sopClassification).toBeDefined();
    expect(detail.sopClassification.sopSlug).toBe("test-order-lookup");
    expect(detail.sopClassification.source).toBe("server");
  });
});
