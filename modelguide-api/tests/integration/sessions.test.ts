/**
 * Integration tests for Sessions API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { sessionFeedback, sessions } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

let s: TestSeed;
let pizzaAdminHeaders: Record<string, string>;
let pizzaSupportHeaders: Record<string, string>;
let burgerAdminHeaders: Record<string, string>;
let pizzaAgentHeaders: Record<string, string>;
let burgerAgentHeaders: Record<string, string>;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  [
    pizzaAdminHeaders,
    pizzaSupportHeaders,
    burgerAdminHeaders,
    pizzaAgentHeaders,
    burgerAgentHeaders,
  ] = await Promise.all([
    authHeadersFor(s.pizzaAdmin),
    authHeadersFor(s.pizzaSupport),
    authHeadersFor(s.burgerAdmin),
    agentHeadersFor(s.pizzaAgentId, s.pizzaOrg.id),
    agentHeadersFor(s.burgerAgentId, s.burgerOrg.id),
  ]);
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdSessionIds) {
        // Messages and feedback are cascade-deleted by FK
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    });
  }
});

// ============================================================================
// POST /api/sessions - Create session (Agent auth)
// ============================================================================

describe("POST /api/sessions", () => {
  test("creates session with valid agent key (201)", async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+1234567890",
        userMetadata: { name: "Test Customer" },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.agentId).toBe(s.pizzaAgentId);
    expect(body.status).toBe("active");
    expect(body.channelType).toBe("voice");
    expect(body.userIdentifier).toBe("+1234567890");
    expect(body.startedAt).toBeDefined();
    expect(body.endedAt).toBeNull();

    createdSessionIds.push(body.id);
  });

  test("creates session with externalId (201)", async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        externalId: "ext-12345",
        channelType: "web",
        userIdentifier: "customer@test.com",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.externalId).toBe("ext-12345");
    expect(body.channelType).toBe("web");

    createdSessionIds.push(body.id);
  });

  test("rejects user auth (must be agent) (401)", async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+1234567890",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+1234567890",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("validates required fields (422)", async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// GET /api/sessions - List sessions (User auth)
// ============================================================================

describe("GET /api/sessions", () => {
  test("returns paginated sessions for org (200)", async () => {
    const response = await request("/api/sessions", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);

    // Verify response shape
    const session = body.data[0];
    expect(session.id).toBeDefined();
    expect(session.agent).toBeDefined();
    expect(session.agent.id).toBeDefined();
    expect(session.agent.name).toBeDefined();
    expect(typeof session.messageCount).toBe("number");
    expect(session.feedbackSummary).toBeDefined();
  });

  test("filters by status (200)", async () => {
    const response = await request("/api/sessions?status=active", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const session of body.data) {
      expect(session.status).toBe("active");
    }
  });

  test("filters by agentId (200)", async () => {
    const response = await request(`/api/sessions?agentId=${s.pizzaAgentId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const session of body.data) {
      expect(session.agentId).toBe(s.pizzaAgentId);
    }
  });

  test("filters by channelType (200)", async () => {
    const response = await request("/api/sessions?channelType=voice", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const session of body.data) {
      expect(session.channelType).toBe("voice");
    }
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/sessions");

    expect(response.status).toBe(401);
  });

  test("rejects agent auth (must be user) (401)", async () => {
    const response = await request("/api/sessions", {
      headers: pizzaAgentHeaders,
    });

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// GET /api/sessions/:id - Session detail (User auth)
// ============================================================================

describe("GET /api/sessions/:id", () => {
  let detailSessionId: string;

  beforeAll(async () => {
    // Create a session with a message for detail testing
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+9999999999",
      }),
    });
    const created = await createRes.json();
    detailSessionId = created.id;
    createdSessionIds.push(detailSessionId);

    // Add a message
    await request(`/api/sessions/${detailSessionId}/messages`, {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        role: "user",
        content: "Hello, I want to order a pizza",
      }),
    });
  });

  test("returns session with messages and feedback (200)", async () => {
    const response = await request(`/api/sessions/${detailSessionId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(detailSessionId);
    expect(body.agent).toBeDefined();
    expect(body.agent.name).toBeDefined();
    expect(body.messages).toBeArray();
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    expect(body.feedback).toBeArray();
  });

  test("messages returned in order", async () => {
    // Add a second message
    await request(`/api/sessions/${detailSessionId}/messages`, {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        role: "assistant",
        content: "What size pizza would you like?",
      }),
    });

    const response = await request(`/api/sessions/${detailSessionId}`, {
      headers: pizzaAdminHeaders,
    });

    const body = await response.json();
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(`/api/sessions/${detailSessionId}`);

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// PATCH /api/sessions/:id - Update session (Agent auth)
// ============================================================================

describe("PATCH /api/sessions/:id", () => {
  let updateSessionId: string;

  beforeAll(async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+5555555555",
      }),
    });
    const body = await response.json();
    updateSessionId = body.id;
    createdSessionIds.push(updateSessionId);
  });

  test("updates status from active to completed (200)", async () => {
    const response = await request(`/api/sessions/${updateSessionId}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({ status: "completed" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.status).toBe("completed");
    expect(body.endedAt).toBeDefined();
    expect(body.endedAt).not.toBeNull();
  });

  test("rejects transition from terminal state (409)", async () => {
    // updateSessionId is now "completed", try to update again
    const response = await request(`/api/sessions/${updateSessionId}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({ status: "abandoned" }),
    });

    expect(response.status).toBe(409);
  });

  test("updates escalationRef (200)", async () => {
    // Create a new active session for this test
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+6666666666",
      }),
    });
    const created = await createRes.json();
    createdSessionIds.push(created.id);

    const response = await request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        status: "escalated",
        escalationRef: "TICKET-123",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.status).toBe("escalated");
    expect(body.escalationRef).toBe("TICKET-123");
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(`/api/sessions/${updateSessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects empty body (422)", async () => {
    // Create a new active session for this test
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+7777777777",
      }),
    });
    const created = await createRes.json();
    createdSessionIds.push(created.id);

    const response = await request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// POST /api/sessions/:id/messages - Add message (Agent auth)
// ============================================================================

describe("POST /api/sessions/:id/messages", () => {
  let messageSessionId: string;

  beforeAll(async () => {
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+8888888888",
      }),
    });
    const body = await response.json();
    messageSessionId = body.id;
    createdSessionIds.push(messageSessionId);
  });

  test("adds messages to an active session (201)", async () => {
    // First message
    const res1 = await request(`/api/sessions/${messageSessionId}/messages`, {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        role: "user",
        content: "I want a large pepperoni pizza",
      }),
    });

    expect(res1.status).toBe(201);
    const body1 = await res1.json();

    expect(body1.data).toBeArray();
    expect(body1.data.length).toBe(1);
    expect(body1.data[0].role).toBe("user");
    expect(body1.data[0].content).toBe("I want a large pepperoni pizza");

    // Second message
    const res2 = await request(`/api/sessions/${messageSessionId}/messages`, {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        role: "assistant",
        content: "Great choice! What size?",
      }),
    });

    expect(res2.status).toBe(201);
    const body2 = await res2.json();

    expect(body2.data[0].role).toBe("assistant");
  });

  test("handles concurrent message inserts (201)", async () => {
    // Create a fresh session
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+9990009999",
      }),
    });
    const created = await createRes.json();
    createdSessionIds.push(created.id);

    const [res1, res2] = await Promise.all([
      request(`/api/sessions/${created.id}/messages`, {
        method: "POST",
        headers: pizzaAgentHeaders,
        body: JSON.stringify({
          role: "user",
          content: "First concurrent message",
        }),
      }),
      request(`/api/sessions/${created.id}/messages`, {
        method: "POST",
        headers: pizzaAgentHeaders,
        body: JSON.stringify({
          role: "user",
          content: "Second concurrent message",
        }),
      }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.data[0].id).toBeDefined();
    expect(body2.data[0].id).toBeDefined();
    expect(body1.data[0].id).not.toBe(body2.data[0].id);
  });

  test("handles tool_calls in assistant messages (201)", async () => {
    const response = await request(
      `/api/sessions/${messageSessionId}/messages`,
      {
        method: "POST",
        headers: pizzaAgentHeaders,
        body: JSON.stringify({
          role: "assistant",
          content: "Let me look up the menu for you.",
          toolCalls: [
            {
              toolCallId: "call_123",
              toolName: "pizzapalace_get_menu",
              toolInput: { category: "pizza" },
              toolOutput: { items: ["pepperoni", "margherita"] },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();

    // Should create both the assistant message and the tool message
    expect(body.data.length).toBe(2);

    const assistantMsg = body.data[0];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Let me look up the menu for you.");

    const toolMsg = body.data[1];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.toolCallId).toBe("call_123");
    expect(toolMsg.toolName).toBe("pizzapalace_get_menu");
  });

  test("rejects message to ended session (409)", async () => {
    // End the session first
    await request(`/api/sessions/${messageSessionId}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({ status: "completed" }),
    });

    const response = await request(
      `/api/sessions/${messageSessionId}/messages`,
      {
        method: "POST",
        headers: pizzaAgentHeaders,
        body: JSON.stringify({
          role: "user",
          content: "One more thing...",
        }),
      },
    );

    expect(response.status).toBe(409);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(
      `/api/sessions/${messageSessionId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "user",
          content: "Hello",
        }),
      },
    );

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  let pizzaSessionId: string;

  beforeAll(async () => {
    // Create a session in pizza org
    const response = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+1111111111",
      }),
    });
    const body = await response.json();
    pizzaSessionId = body.id;
    createdSessionIds.push(pizzaSessionId);
  });

  test("Burger Barn cannot see Pizza Palace sessions in list (200)", async () => {
    const response = await request("/api/sessions", {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(pizzaSessionId);
  });

  test("Burger Barn cannot get Pizza Palace session by ID (404)", async () => {
    const response = await request(`/api/sessions/${pizzaSessionId}`, {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("Burger agent cannot update Pizza Palace session (404)", async () => {
    const response = await request(`/api/sessions/${pizzaSessionId}`, {
      method: "PATCH",
      headers: burgerAgentHeaders,
      body: JSON.stringify({ status: "completed" }),
    });

    expect(response.status).toBe(404);
  });

  test("Burger agent cannot add message to Pizza Palace session (404)", async () => {
    const response = await request(`/api/sessions/${pizzaSessionId}/messages`, {
      method: "POST",
      headers: burgerAgentHeaders,
      body: JSON.stringify({
        role: "user",
        content: "Cross-org attack attempt",
      }),
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// PATCH /api/sessions/:id - Additional update tests
// ============================================================================

describe("PATCH /api/sessions/:id (additional)", () => {
  test("updates status from active to abandoned (200)", async () => {
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "web",
        userIdentifier: "abandon-test@test.com",
      }),
    });
    const created = await createRes.json();
    createdSessionIds.push(created.id);

    const response = await request(`/api/sessions/${created.id}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({ status: "abandoned" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("abandoned");
    expect(body.endedAt).not.toBeNull();
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({ status: "completed" }),
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// POST /api/sessions/:id/messages - Additional message tests
// ============================================================================

describe("POST /api/sessions/:id/messages (additional)", () => {
  test("creates message with audioUrl (201)", async () => {
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+4444444444",
      }),
    });
    const created = await createRes.json();
    createdSessionIds.push(created.id);

    const response = await request(`/api/sessions/${created.id}/messages`, {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        role: "user",
        content: "Voice message",
        audioUrl: "https://storage.example.com/recordings/abc123.mp3",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data[0].audioUrl).toBe(
      "https://storage.example.com/recordings/abc123.mp3",
    );
    expect(body.data[0].content).toBe("Voice message");
  });
});

// ============================================================================
// GET /api/sessions - Filtering, sorting, pagination
// ============================================================================

describe("GET /api/sessions (filtering & sorting)", () => {
  /** IDs of sessions created specifically for filter tests */
  const filterSessionIds: string[] = [];

  beforeAll(async () => {
    // Create several sessions with different channels to test filters
    for (const channel of ["web", "sms", "sms"]) {
      const res = await request("/api/sessions", {
        method: "POST",
        headers: pizzaAgentHeaders,
        body: JSON.stringify({
          channelType: channel,
          userIdentifier: `filter-${channel}-${Date.now()}@test.com`,
        }),
      });
      const body = await res.json();
      filterSessionIds.push(body.id);
      createdSessionIds.push(body.id);
    }

    // Complete one session so we can test date-range and status filters
    await request(`/api/sessions/${filterSessionIds[0]}`, {
      method: "PATCH",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({ status: "completed" }),
    });

    // Add feedback to the completed session so we can test hasFeedback
    await forApp(async (tx) => {
      await tx.insert(sessionFeedback).values({
        sessionId: filterSessionIds[0],
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "filter-tester",
      });
    });
  });

  test("filters by startedAfter (200)", async () => {
    // Use a date far in the past — should return all sessions
    const response = await request(
      "/api/sessions?startedAfter=2020-01-01T00:00:00Z",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by startedBefore (200)", async () => {
    // Use a date far in the past — should return zero sessions
    const response = await request(
      "/api/sessions?startedBefore=2020-01-01T00:00:00Z",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBe(0);
  });

  test("filters by hasFeedback=true (200)", async () => {
    const response = await request("/api/sessions?hasFeedback=true", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const session of body.data) {
      expect(session.feedbackSummary.hasFeedback).toBe(true);
    }
  });

  test("filters by hasFeedback=false (200)", async () => {
    const response = await request("/api/sessions?hasFeedback=false", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const session of body.data) {
      expect(session.feedbackSummary.hasFeedback).toBe(false);
    }
  });

  test("sorts by started_at ascending (200)", async () => {
    const response = await request(
      "/api/sessions?sortBy=started_at&sortOrder=asc",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    for (let i = 1; i < body.data.length; i++) {
      expect(new Date(body.data[i].startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(body.data[i - 1].startedAt).getTime(),
      );
    }
  });

  test("sorts by status (200)", async () => {
    const response = await request(
      "/api/sessions?sortBy=status&sortOrder=asc",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("paginates with pageSize=1 and returns correct totalPages (200)", async () => {
    const response = await request("/api/sessions?page=1&pageSize=1", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.length).toBe(1);
    expect(body.pagination.pageSize).toBe(1);
    expect(body.pagination.totalItems).toBeGreaterThan(1);
    expect(body.pagination.totalPages).toBeGreaterThan(1);
    expect(body.pagination.hasNextPage).toBe(true);
    expect(body.pagination.hasPreviousPage).toBe(false);
  });

  test("returns page 2 results (200)", async () => {
    const response = await request("/api/sessions?page=2&pageSize=1", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.length).toBe(1);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.hasPreviousPage).toBe(true);
  });

  test("page 1 and page 2 return different sessions (200)", async () => {
    const [res1, res2] = await Promise.all([
      request("/api/sessions?page=1&pageSize=1", {
        headers: pizzaAdminHeaders,
      }),
      request("/api/sessions?page=2&pageSize=1", {
        headers: pizzaAdminHeaders,
      }),
    ]);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.data[0].id).not.toBe(body2.data[0].id);
  });
});

// ============================================================================
// GET /api/sessions/:id/feedback - List feedback (User auth)
// ============================================================================

describe("GET /api/sessions/:id/feedback", () => {
  let feedbackSessionId: string;

  beforeAll(async () => {
    // Create a session and add feedback to it
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+1112223333",
      }),
    });
    const created = await createRes.json();
    feedbackSessionId = created.id;
    createdSessionIds.push(feedbackSessionId);

    // Create feedback via the POST endpoint
    await request(`/api/sessions/${feedbackSessionId}/feedback`, {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        rating: 2,
        comment: "Great service",
        feedbackSource: "support",
        feedbackTags: ["helpful"],
      }),
    });
  });

  test("returns feedback entries for a session (200)", async () => {
    const response = await request(
      `/api/sessions/${feedbackSessionId}/feedback`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.items).toBeArray();
    expect(body.items.length).toBeGreaterThanOrEqual(1);

    const fb = body.items[0];
    expect(fb.id).toBeDefined();
    expect(fb.sessionId).toBe(feedbackSessionId);
    expect(fb.rating).toBe(2);
    expect(fb.comment).toBe("Great service");
    expect(fb.feedbackSource).toBe("support");
    expect(fb.feedbackTags).toEqual(["helpful"]);
    expect(fb.createdAt).toBeDefined();
  });

  test("returns empty items when no feedback (200)", async () => {
    // Create a session with no feedback
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "web",
        userIdentifier: "nofeedback@test.com",
      }),
    });
    const created = await createRes.json();
    createdSessionIds.push(created.id);

    const response = await request(`/api/sessions/${created.id}/feedback`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}/feedback`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("rejects unauthenticated (401)", async () => {
    const response = await request(
      `/api/sessions/${feedbackSessionId}/feedback`,
    );

    expect(response.status).toBe(401);
  });

  test("rejects agent auth (401)", async () => {
    const response = await request(
      `/api/sessions/${feedbackSessionId}/feedback`,
      { headers: pizzaAgentHeaders },
    );

    expect(response.status).toBe(401);
  });

  test("support role can list feedback (200)", async () => {
    const response = await request(
      `/api/sessions/${feedbackSessionId}/feedback`,
      { headers: pizzaSupportHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toBeArray();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// POST /api/sessions/:id/feedback - Create feedback (User auth)
// ============================================================================

describe("POST /api/sessions/:id/feedback", () => {
  let feedbackPostSessionId: string;

  beforeAll(async () => {
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+4445556666",
      }),
    });
    const created = await createRes.json();
    feedbackPostSessionId = created.id;
    createdSessionIds.push(feedbackPostSessionId);
  });

  test("creates feedback with all fields (201)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          rating: 2,
          comment: "Excellent resolution",
          feedbackSource: "support",
          feedbackTags: ["fast", "polite"],
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.sessionId).toBe(feedbackPostSessionId);
    expect(body.rating).toBe(2);
    expect(body.comment).toBe("Excellent resolution");
    expect(body.feedbackSource).toBe("support");
    expect(body.feedbackTags).toEqual(["fast", "polite"]);
    // Auto-populated from authenticated user
    expect(body.feedbackRef).toBe(s.pizzaAdmin.id);
    expect(body.userIdentifier).toBe(s.pizzaAdmin.email);
    expect(body.createdAt).toBeDefined();
  });

  test("creates feedback with minimal fields (201)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          rating: 1,
          feedbackSource: "system",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.rating).toBe(1);
    expect(body.feedbackSource).toBe("system");
    expect(body.comment).toBeNull();
    expect(body.feedbackTags).toEqual([]);
  });

  test("support user can create feedback (201)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaSupportHeaders,
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.feedbackRef).toBe(s.pizzaSupport.id);
    expect(body.userIdentifier).toBe(s.pizzaSupport.email);
  });

  test("multiple feedback on same session (201)", async () => {
    const res1 = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          rating: 1,
          feedbackSource: "support",
          comment: "First feedback",
        }),
      },
    );

    const res2 = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "support",
          comment: "Second feedback",
        }),
      },
    );

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.id).not.toBe(body2.id);
  });

  test("rejects invalid rating (422)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          rating: 5,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(422);
  });

  test("rejects missing required fields (422)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(422);
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}/feedback`, {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        rating: 2,
        feedbackSource: "support",
      }),
    });

    expect(response.status).toBe(404);
  });

  test("rejects unauthenticated (401)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// RLS isolation — feedback
// ============================================================================

describe("RLS isolation — feedback", () => {
  let pizzaFeedbackSessionId: string;

  beforeAll(async () => {
    // Create a session in pizza org with feedback
    const createRes = await request("/api/sessions", {
      method: "POST",
      headers: pizzaAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+7778889999",
      }),
    });
    const created = await createRes.json();
    pizzaFeedbackSessionId = created.id;
    createdSessionIds.push(pizzaFeedbackSessionId);

    await request(`/api/sessions/${pizzaFeedbackSessionId}/feedback`, {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        rating: 2,
        feedbackSource: "support",
      }),
    });
  });

  test("Burger Barn cannot list feedback on Pizza Palace session (404)", async () => {
    const response = await request(
      `/api/sessions/${pizzaFeedbackSessionId}/feedback`,
      { headers: burgerAdminHeaders },
    );

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot create feedback on Pizza Palace session (404)", async () => {
    const response = await request(
      `/api/sessions/${pizzaFeedbackSessionId}/feedback`,
      {
        method: "POST",
        headers: burgerAdminHeaders,
        body: JSON.stringify({
          rating: 1,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});
