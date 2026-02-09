/**
 * Integration tests for Analytics API
 * Tests summary and trends endpoints with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { sessionFeedback, sessionMessages, sessions } from "@db/schema";
import { eq } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let pizzaAdminHeaders: Record<string, string>;
let pizzaSupportHeaders: Record<string, string>;
let burgerAdminHeaders: Record<string, string>;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

const FROM = "2020-01-01";
const TO = "2030-12-31";

beforeAll(async () => {
  s = await getTestSeed();
  [pizzaAdminHeaders, pizzaSupportHeaders, burgerAdminHeaders] =
    await Promise.all([
      authHeadersFor(s.pizzaAdmin),
      authHeadersFor(s.pizzaSupport),
      authHeadersFor(s.burgerAdmin),
    ]);

  // Create test sessions with varied statuses, channels, and feedback
  await forApp(async (tx) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);

    const inserted = await tx
      .insert(sessions)
      .values([
        {
          organizationId: s.pizzaOrg.id,
          agentId: s.pizzaAgentId,
          channelType: "voice",
          status: "completed",
          startedAt: oneHourAgo,
          endedAt: now,
        },
        {
          organizationId: s.pizzaOrg.id,
          agentId: s.pizzaAgentId,
          channelType: "web",
          status: "escalated",
          startedAt: oneHourAgo,
          endedAt: now,
        },
        {
          organizationId: s.pizzaOrg.id,
          agentId: s.pizzaAgentId,
          channelType: "voice",
          status: "abandoned",
          startedAt: oneHourAgo,
          endedAt: now,
        },
        {
          organizationId: s.pizzaOrg.id,
          agentId: s.pizzaAgentId,
          channelType: "web",
          status: "completed",
          startedAt: oneHourAgo,
          endedAt: now,
        },
      ])
      .returning();

    for (const session of inserted) {
      createdSessionIds.push(session.id);
    }

    // Add feedback to completed sessions
    await tx.insert(sessionFeedback).values([
      {
        sessionId: inserted[0].id,
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "analytics-test-customer-1",
      },
      {
        sessionId: inserted[0].id,
        rating: 1,
        feedbackSource: "support",
        userIdentifier: "analytics-test-support-1",
      },
      {
        sessionId: inserted[3].id,
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "analytics-test-customer-2",
      },
    ]);

    // Add session messages for avg_messages_per_session testing
    await tx.insert(sessionMessages).values([
      {
        sessionId: inserted[0].id,
        role: "user",
        content: "Hello",
      },
      {
        sessionId: inserted[0].id,
        role: "assistant",
        content: "Hi there!",
      },
      {
        sessionId: inserted[0].id,
        role: "tool",
        content: "tool result",
      },
      {
        sessionId: inserted[3].id,
        role: "user",
        content: "I need help",
      },
      {
        sessionId: inserted[3].id,
        role: "assistant",
        content: "Sure!",
      },
      {
        sessionId: inserted[3].id,
        role: "user",
        content: "Thanks",
      },
      {
        sessionId: inserted[3].id,
        role: "assistant",
        content: "You're welcome",
      },
    ]);
  });
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await forApp(async (tx) => {
      // Feedback is cascade-deleted via session FK
      for (const id of createdSessionIds) {
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/analytics - Summary
// ============================================================================

describe("GET /api/analytics", () => {
  test("returns summary with valid date range (200)", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // Verify response shape
    expect(body.period).toBeDefined();
    expect(body.period.from).toBe(FROM);
    expect(body.period.to).toBe(TO);
    expect(typeof body.total_sessions).toBe("number");
    expect(body.total_sessions).toBeGreaterThanOrEqual(4);
    expect(body.sessions_by_status).toBeDefined();
    expect(typeof body.sessions_by_status.completed).toBe("number");
    expect(typeof body.sessions_by_status.escalated).toBe("number");
    expect(typeof body.sessions_by_status.abandoned).toBe("number");
    expect(typeof body.sessions_by_status.active).toBe("number");
    expect(body.sessions_by_channel).toBeDefined();
    expect(typeof body.sessions_by_channel.voice).toBe("number");
    expect(typeof body.sessions_by_channel.web).toBe("number");
    expect(typeof body.resolution_rate).toBe("number");
    expect(typeof body.escalation_rate).toBe("number");
    expect(typeof body.abandonment_rate).toBe("number");
    expect(body.feedback_count).toBeDefined();
    expect(typeof body.feedback_count.customer).toBe("number");
    expect(typeof body.feedback_count.support).toBe("number");

    // New fields
    expect(typeof body.feedback_coverage_rate).toBe("number");
    expect(body.feedback_coverage_rate).toBeGreaterThanOrEqual(0);
    expect(body.feedback_coverage_rate).toBeLessThanOrEqual(1);

    // avg_messages_per_session: number or null
    if (body.avg_messages_per_session !== null) {
      expect(typeof body.avg_messages_per_session).toBe("number");
      expect(body.avg_messages_per_session).toBeGreaterThan(0);
    }

    // previous_period: object or null
    expect("previous_period" in body).toBe(true);
    if (body.previous_period !== null) {
      expect(typeof body.previous_period.total_sessions).toBe("number");
      expect(typeof body.previous_period.resolution_rate).toBe("number");
    }
  });

  test("counts match expected data", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    const body = await response.json();

    // We created 4 test sessions + 1 seeded active session
    expect(body.sessions_by_status.completed).toBeGreaterThanOrEqual(2);
    expect(body.sessions_by_status.escalated).toBeGreaterThanOrEqual(1);
    expect(body.sessions_by_status.abandoned).toBeGreaterThanOrEqual(1);

    // Feedback from our test data
    expect(body.feedback_count.customer).toBeGreaterThanOrEqual(2);
    expect(body.feedback_count.support).toBeGreaterThanOrEqual(1);

    // CSAT score should be non-null
    expect(body.csat_score).not.toBeNull();

    // Duration should be non-null (our completed sessions have endedAt)
    expect(body.avg_duration_seconds).not.toBeNull();
    expect(body.avg_duration_seconds).toBeGreaterThan(0);
  });

  test("accessible by support role (200)", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaSupportHeaders },
    );

    expect(response.status).toBe(200);
  });

  test("filters by agent_id", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}&agent_id=${s.pizzaAgentId}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total_sessions).toBeGreaterThanOrEqual(4);
  });

  test("filters by channel_type", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}&channel_type=web`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // We created 2 web sessions
    expect(body.total_sessions).toBeGreaterThanOrEqual(2);
    expect(body.sessions_by_channel.voice).toBe(0);
    expect(body.sessions_by_channel.web).toBeGreaterThanOrEqual(2);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}`,
    );

    expect(response.status).toBe(401);
  });

  test("requires from_date and to_date (422)", async () => {
    const response = await request("/api/analytics", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(422);
  });

  test("requires valid from_date format (422)", async () => {
    const response = await request(
      "/api/analytics?from_date=not-a-date&to_date=2030-12-31",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("rejects inverted date range (422)", async () => {
    const response = await request(
      "/api/analytics?from_date=2030-01-01&to_date=2020-01-01",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("handles empty data range gracefully", async () => {
    // Use a date range in the far future where no sessions exist
    const response = await request(
      "/api/analytics?from_date=2099-01-01&to_date=2099-12-31",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total_sessions).toBe(0);
    expect(body.resolution_rate).toBe(0);
    expect(body.escalation_rate).toBe(0);
    expect(body.abandonment_rate).toBe(0);
    expect(body.avg_duration_seconds).toBeNull();
    expect(body.csat_score).toBeNull();
    expect(body.support_evaluation_score).toBeNull();
    expect(body.feedback_count.customer).toBe(0);
    expect(body.feedback_count.support).toBe(0);
    expect(body.avg_messages_per_session).toBeNull();
    expect(body.feedback_coverage_rate).toBe(0);
  });

  test("includes avg_messages_per_session from session messages", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    const body = await response.json();

    // We added messages to 2 sessions: session[0] has 2 user+assistant messages,
    // session[3] has 4 user+assistant messages. Average should be 3.
    expect(body.avg_messages_per_session).not.toBeNull();
    expect(body.avg_messages_per_session).toBeGreaterThan(0);
  });

  test("includes feedback_coverage_rate", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    const body = await response.json();

    // 2 of our 4 test sessions have customer feedback
    expect(body.feedback_coverage_rate).toBeGreaterThan(0);
    expect(body.feedback_coverage_rate).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// GET /api/analytics/trends - Trends
// ============================================================================

describe("GET /api/analytics/trends", () => {
  test("returns sessions trend with valid params (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("sessions");
    expect(body.granularity).toBe("day");
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Verify data point shape
    const point = body.data[0];
    expect(point.date).toBeDefined();
    expect(typeof point.value).toBe("number");
  });

  test("returns csat trend (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=csat&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("csat");
    expect(body.data).toBeArray();
  });

  test("returns resolution_rate trend (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=resolution_rate&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("resolution_rate");
    expect(body.data).toBeArray();
  });

  test("returns escalation_rate trend (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=escalation_rate&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("escalation_rate");
  });

  test("returns duration trend (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=duration&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("duration");
    expect(body.data).toBeArray();
  });

  test("supports all granularities", async () => {
    for (const granularity of ["hour", "day", "week", "month"]) {
      const response = await request(
        `/api/analytics/trends?metric=sessions&granularity=${granularity}&from_date=${FROM}&to_date=${TO}`,
        { headers: pizzaAdminHeaders },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.granularity).toBe(granularity);
    }
  });

  test("filters by agent_id", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}&agent_id=${s.pizzaAgentId}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeArray();
  });

  test("filters by channel_type", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}&channel_type=voice`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeArray();
  });

  test("accessible by support role (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaSupportHeaders },
    );

    expect(response.status).toBe(200);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
    );

    expect(response.status).toBe(401);
  });

  test("requires metric and granularity (422)", async () => {
    const response = await request(
      `/api/analytics/trends?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("rejects invalid metric (422)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=invalid&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("rejects inverted date range (422)", async () => {
    const response = await request(
      "/api/analytics/trends?metric=sessions&granularity=day&from_date=2030-01-01&to_date=2020-01-01",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("handles empty data range gracefully", async () => {
    const response = await request(
      "/api/analytics/trends?metric=sessions&granularity=day&from_date=2099-01-01&to_date=2099-12-31",
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBe(0);
  });
});

// ============================================================================
// GET /api/analytics/agents - Agent Performance
// ============================================================================

describe("GET /api/analytics/agents", () => {
  test("returns agent performance with valid params (200)", async () => {
    const response = await request(
      `/api/analytics/agents?from_date=${FROM}&to_date=${TO}`,
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.agents).toBeArray();
    expect(body.agents.length).toBeGreaterThanOrEqual(1);

    const agent = body.agents[0];
    expect(agent.agent_id).toBeDefined();
    expect(agent.agent_name).toBeDefined();
    expect(typeof agent.total_sessions).toBe("number");
    expect(typeof agent.resolution_rate).toBe("number");
    expect(typeof agent.escalation_rate).toBe("number");
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(
      `/api/analytics/agents?from_date=${FROM}&to_date=${TO}`,
    );

    expect(response.status).toBe(401);
  });

  test("RLS isolates agent performance by org", async () => {
    const [pizzaRes, burgerRes] = await Promise.all([
      request(`/api/analytics/agents?from_date=${FROM}&to_date=${TO}`, {
        headers: pizzaAdminHeaders,
      }),
      request(`/api/analytics/agents?from_date=${FROM}&to_date=${TO}`, {
        headers: burgerAdminHeaders,
      }),
    ]);

    const pizzaBody = await pizzaRes.json();
    const burgerBody = await burgerRes.json();

    // Pizza Palace should have agents with sessions
    const pizzaTotal = pizzaBody.agents.reduce(
      (sum: number, a: { total_sessions: number }) => sum + a.total_sessions,
      0,
    );
    const burgerTotal = burgerBody.agents.reduce(
      (sum: number, a: { total_sessions: number }) => sum + a.total_sessions,
      0,
    );

    expect(pizzaTotal).toBeGreaterThan(burgerTotal);
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  test("Burger Barn cannot see Pizza Palace analytics data", async () => {
    // Get both orgs' summaries and compare
    const [pizzaRes, burgerRes] = await Promise.all([
      request(`/api/analytics?from_date=${FROM}&to_date=${TO}`, {
        headers: pizzaAdminHeaders,
      }),
      request(`/api/analytics?from_date=${FROM}&to_date=${TO}`, {
        headers: burgerAdminHeaders,
      }),
    ]);

    const pizzaBody = await pizzaRes.json();
    const burgerBody = await burgerRes.json();

    // Pizza Palace should have our 4 test sessions (2 completed, 1 escalated, 1 abandoned)
    expect(pizzaBody.sessions_by_status.completed).toBeGreaterThanOrEqual(2);
    expect(pizzaBody.sessions_by_status.escalated).toBeGreaterThanOrEqual(1);
    expect(pizzaBody.sessions_by_status.abandoned).toBeGreaterThanOrEqual(1);

    // Burger Barn should have strictly fewer total sessions than Pizza Palace
    // (seed creates 1 active session per org; our test adds 4 only to pizza)
    expect(burgerBody.total_sessions).toBeLessThan(pizzaBody.total_sessions);

    // Burger Barn should have no completed/escalated/abandoned sessions
    // (seed only creates active sessions)
    expect(burgerBody.sessions_by_status.completed).toBe(0);
    expect(burgerBody.sessions_by_status.escalated).toBe(0);
    expect(burgerBody.sessions_by_status.abandoned).toBe(0);
  });

  test("Burger Barn trends do not include Pizza Palace sessions", async () => {
    const [pizzaRes, burgerRes] = await Promise.all([
      request(
        `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
        { headers: pizzaAdminHeaders },
      ),
      request(
        `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
        { headers: burgerAdminHeaders },
      ),
    ]);

    const pizzaBody = await pizzaRes.json();
    const burgerBody = await burgerRes.json();

    const pizzaTotal = pizzaBody.data.reduce(
      (sum: number, p: { value: number }) => sum + p.value,
      0,
    );
    const burgerTotal = burgerBody.data.reduce(
      (sum: number, p: { value: number }) => sum + p.value,
      0,
    );

    // Pizza Palace should have strictly more sessions than Burger Barn
    expect(pizzaTotal).toBeGreaterThan(burgerTotal);
  });
});
