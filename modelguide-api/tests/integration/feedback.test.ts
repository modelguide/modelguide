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
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let orgAAgentHeaders: Record<string, string>;

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
  [orgAAdminHeaders, orgASupportHeaders, orgBAdminHeaders, orgAAgentHeaders] =
    await Promise.all([
      authHeadersFor(s.orgAAdmin),
      authHeadersFor(s.orgASupport),
      authHeadersFor(s.orgBAdmin),
      agentHeadersFor(s.orgAAgentId, s.orgA.id),
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
      orgAAgentHeaders,
      "+1112223333",
    );

    // Create feedback via the POST endpoint
    await request(`/api/sessions/${feedbackSessionId}/feedback`, {
      method: "POST",
      headers: orgAAdminHeaders,
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
      { headers: orgAAdminHeaders },
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
      orgAAgentHeaders,
      "nofeedback@test.com",
      "web",
    );

    const response = await request(`/api/sessions/${sessionId}/feedback`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}/feedback`, {
      headers: orgAAdminHeaders,
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
      { headers: orgAAgentHeaders },
    );

    expect(response.status).toBe(401);
  });

  test("support role can list feedback (200)", async () => {
    const response = await request(
      `/api/sessions/${feedbackSessionId}/feedback`,
      { headers: orgASupportHeaders },
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
      orgAAgentHeaders,
      "+4445556666",
    );
  });

  test("creates feedback with all fields (201)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
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
    expect(body.feedbackRef).toBe(s.orgAAdmin.id);
    expect(body.userIdentifier).toBe(s.orgAAdmin.email);
    expect(body.createdAt).toBeDefined();
  });

  test("creates feedback with minimal fields (201)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
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
        headers: orgASupportHeaders,
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.feedbackRef).toBe(s.orgASupport.id);
    expect(body.userIdentifier).toBe(s.orgASupport.email);
  });

  test("upserts when same user+source submits again (201)", async () => {
    const res1 = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
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
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "support",
          comment: "Updated feedback",
        }),
      },
    );

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = await res1.json();
    const body2 = await res2.json();
    // Same row updated (upsert), not a new row
    expect(body2.id).toBe(body1.id);
    expect(body2.rating).toBe(2);
    expect(body2.comment).toBe("Updated feedback");
    expect(body2.updatedAt).toBeDefined();
  });

  test("different sources create separate entries (201)", async () => {
    const resSupport = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgASupportHeaders,
        body: JSON.stringify({
          rating: 1,
          feedbackSource: "system",
        }),
      },
    );

    const resSystem = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "system",
        }),
      },
    );

    expect(resSupport.status).toBe(201);
    expect(resSystem.status).toBe(201);

    const bodySupport = await resSupport.json();
    const bodySystem = await resSystem.json();
    // Different feedbackRef (different users) → separate rows
    expect(bodySupport.id).not.toBe(bodySystem.id);
  });

  test("rejects rating above maximum (422)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          rating: 5,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(422);
  });

  test("rejects rating below minimum (422)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          rating: 0,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(422);
  });

  test("rejects customer feedbackSource via REST (422)", async () => {
    const response = await request(
      `/api/sessions/${feedbackPostSessionId}/feedback`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          rating: 2,
          feedbackSource: "customer",
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
        headers: orgAAdminHeaders,
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(422);
  });

  test("returns 404 for non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/sessions/${fakeId}/feedback`, {
      method: "POST",
      headers: orgAAdminHeaders,
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
  let orgAFeedbackSessionId: string;

  beforeAll(async () => {
    orgAFeedbackSessionId = await createTestSession(
      orgAAgentHeaders,
      "+7778889999",
    );

    await request(`/api/sessions/${orgAFeedbackSessionId}/feedback`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        rating: 2,
        feedbackSource: "support",
      }),
    });
  });

  test("org B cannot list feedback on org A session (404)", async () => {
    const response = await request(
      `/api/sessions/${orgAFeedbackSessionId}/feedback`,
      { headers: orgBAdminHeaders },
    );

    expect(response.status).toBe(404);
  });

  test("org B cannot create feedback on org A session (404)", async () => {
    const response = await request(
      `/api/sessions/${orgAFeedbackSessionId}/feedback`,
      {
        method: "POST",
        headers: orgBAdminHeaders,
        body: JSON.stringify({
          rating: 1,
          feedbackSource: "support",
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// CRUD audit — strict validation (#64)
// ============================================================================

describe("Strict PATCH schema", () => {
  test("rejects unknown fields with 422", async () => {
    const sessionId = await createTestSession(
      orgAAgentHeaders,
      "strict-feedback@test.com",
      "web",
    );

    const fbRes = await request(`/api/sessions/${sessionId}/feedback`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        rating: 2,
        feedbackSource: "support",
      }),
    });
    const fb = await fbRes.json();

    const response = await request(
      `/api/sessions/${sessionId}/feedback/${fb.id}`,
      {
        method: "PATCH",
        headers: orgAAdminHeaders,
        body: JSON.stringify({ rating: 1, invisible: "ghost" }),
      },
    );

    expect(response.status).toBe(422);
  });
});
