/**
 * Integration tests for Feedback API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { sessions } from "@db/schema";
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

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/** Helper to create a session via the agent API */
async function createTestSession(
  agentHeaders: Record<string, string>,
  userIdentifier: string,
  channelType = "voice",
) {
  const res = await request("/api/sessions", {
    method: "POST",
    headers: agentHeaders,
    body: JSON.stringify({ channelType, userIdentifier }),
  });
  const body = await res.json();
  createdSessionIds.push(body.id);
  return body.id as string;
}

beforeAll(async () => {
  s = await getTestSeed();
  [
    pizzaAdminHeaders,
    pizzaSupportHeaders,
    burgerAdminHeaders,
    pizzaAgentHeaders,
  ] = await Promise.all([
    authHeadersFor(s.pizzaAdmin),
    authHeadersFor(s.pizzaSupport),
    authHeadersFor(s.burgerAdmin),
    agentHeadersFor(s.pizzaAgentId, s.pizzaOrg.id),
  ]);
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdSessionIds) {
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/sessions/:id/feedback - List feedback (User auth)
// ============================================================================

describe("GET /api/sessions/:id/feedback", () => {
  let feedbackSessionId: string;

  beforeAll(async () => {
    feedbackSessionId = await createTestSession(
      pizzaAgentHeaders,
      "+1112223333",
    );

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
    const sessionId = await createTestSession(
      pizzaAgentHeaders,
      "nofeedback@test.com",
      "web",
    );

    const response = await request(`/api/sessions/${sessionId}/feedback`, {
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
    feedbackPostSessionId = await createTestSession(
      pizzaAgentHeaders,
      "+4445556666",
    );
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
    pizzaFeedbackSessionId = await createTestSession(
      pizzaAgentHeaders,
      "+7778889999",
    );

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
