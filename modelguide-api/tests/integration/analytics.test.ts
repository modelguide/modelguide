/**
 * Integration tests for Analytics API
 * Tests summary and trends endpoints with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { sessionFeedback, sessionMessages, sessions } from "@db/schema";
import { and, eq, gte, lt } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

const FROM = "2020-01-01";
const TO = "2030-12-31";

beforeAll(async () => {
  s = await getTestSeed();
  [orgAAdminHeaders, orgASupportHeaders, orgBAdminHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    authHeadersFor(s.orgASupport),
    authHeadersFor(s.orgBAdmin),
  ]);

  // Create test sessions with varied statuses, channels, and feedback
  await forApp(async (tx) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);

    const inserted = await tx
      .insert(sessions)
      .values([
        {
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "voice",
          status: "completed",
          startedAt: oneHourAgo,
          endedAt: now,
        },
        {
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "web",
          status: "completed",
          startedAt: oneHourAgo,
          endedAt: now,
        },
        {
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "voice",
          status: "abandoned",
          startedAt: oneHourAgo,
          endedAt: now,
        },
        {
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
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
      { headers: orgAAdminHeaders },
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
    expect(typeof body.sessions_by_status.abandoned).toBe("number");
    expect(typeof body.sessions_by_status.active).toBe("number");
    expect(body.sessions_by_channel).toBeDefined();
    expect(typeof body.sessions_by_channel.voice).toBe("number");
    expect(typeof body.sessions_by_channel.web).toBe("number");
    expect(typeof body.resolution_rate).toBe("number");
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
      { headers: orgAAdminHeaders },
    );

    const body = await response.json();

    // We created 4 test sessions + 1 seeded active session
    expect(body.sessions_by_status.completed).toBeGreaterThanOrEqual(3);
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
      { headers: orgASupportHeaders },
    );

    expect(response.status).toBe(200);
  });

  test("filters by agent_id", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}&agent_id=${s.orgAAgentId}`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total_sessions).toBeGreaterThanOrEqual(4);
  });

  test("filters by channel_type", async () => {
    const response = await request(
      `/api/analytics?from_date=${FROM}&to_date=${TO}&channel_type=web`,
      { headers: orgAAdminHeaders },
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
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(422);
  });

  test("requires valid from_date format (422)", async () => {
    const response = await request(
      "/api/analytics?from_date=not-a-date&to_date=2030-12-31",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("rejects inverted date range (422)", async () => {
    const response = await request(
      "/api/analytics?from_date=2030-01-01&to_date=2020-01-01",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("handles empty data range gracefully", async () => {
    // Use a date range in the far future where no sessions exist
    const response = await request(
      "/api/analytics?from_date=2099-01-01&to_date=2099-12-31",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total_sessions).toBe(0);
    expect(body.resolution_rate).toBe(0);
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
      { headers: orgAAdminHeaders },
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
      { headers: orgAAdminHeaders },
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
      { headers: orgAAdminHeaders },
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
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("csat");
    expect(body.data).toBeArray();
  });

  test("returns resolution_rate trend (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=resolution_rate&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("resolution_rate");
    expect(body.data).toBeArray();
  });

  test("returns duration trend (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=duration&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("duration");
    expect(body.data).toBeArray();
  });

  test("supports all granularities", async () => {
    for (const granularity of ["day", "week", "month"]) {
      const response = await request(
        `/api/analytics/trends?metric=sessions&granularity=${granularity}&from_date=${FROM}&to_date=${TO}`,
        { headers: orgAAdminHeaders },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.granularity).toBe(granularity);
    }

    // Hour granularity requires a narrow date range (max 7 days)
    const today = new Date().toISOString().split("T")[0];
    const sixDaysAgo = new Date(Date.now() - 6 * 86400_000)
      .toISOString()
      .split("T")[0];
    const hourResponse = await request(
      `/api/analytics/trends?metric=sessions&granularity=hour&from_date=${sixDaysAgo}&to_date=${today}`,
      { headers: orgAAdminHeaders },
    );
    expect(hourResponse.status).toBe(200);
    const hourBody = await hourResponse.json();
    expect(hourBody.granularity).toBe("hour");
  });

  test("filters by agent_id", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}&agent_id=${s.orgAAgentId}`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeArray();
  });

  test("filters by channel_type", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}&channel_type=voice`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeArray();
  });

  test("accessible by support role (200)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: orgASupportHeaders },
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
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("rejects invalid metric (422)", async () => {
    const response = await request(
      `/api/analytics/trends?metric=invalid&granularity=day&from_date=${FROM}&to_date=${TO}`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("rejects inverted date range (422)", async () => {
    const response = await request(
      "/api/analytics/trends?metric=sessions&granularity=day&from_date=2030-01-01&to_date=2020-01-01",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("handles empty data range gracefully", async () => {
    const response = await request(
      "/api/analytics/trends?metric=sessions&granularity=day&from_date=2099-01-01&to_date=2099-12-31",
      { headers: orgAAdminHeaders },
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
      { headers: orgAAdminHeaders },
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
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(
      `/api/analytics/agents?from_date=${FROM}&to_date=${TO}`,
    );

    expect(response.status).toBe(401);
  });

  test("RLS isolates agent performance by org", async () => {
    const [orgARes, orgBRes] = await Promise.all([
      request(`/api/analytics/agents?from_date=${FROM}&to_date=${TO}`, {
        headers: orgAAdminHeaders,
      }),
      request(`/api/analytics/agents?from_date=${FROM}&to_date=${TO}`, {
        headers: orgBAdminHeaders,
      }),
    ]);

    const orgABody = await orgARes.json();
    const orgBBody = await orgBRes.json();

    // org A should have agents with sessions
    const orgATotal = orgABody.agents.reduce(
      (sum: number, a: { total_sessions: number }) => sum + a.total_sessions,
      0,
    );
    const orgBTotal = orgBBody.agents.reduce(
      (sum: number, a: { total_sessions: number }) => sum + a.total_sessions,
      0,
    );

    expect(orgATotal).toBeGreaterThan(orgBTotal);
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  test("org B cannot see org A analytics data", async () => {
    // Get both orgs' summaries and compare
    const [orgARes, orgBRes] = await Promise.all([
      request(`/api/analytics?from_date=${FROM}&to_date=${TO}`, {
        headers: orgAAdminHeaders,
      }),
      request(`/api/analytics?from_date=${FROM}&to_date=${TO}`, {
        headers: orgBAdminHeaders,
      }),
    ]);

    const orgABody = await orgARes.json();
    const orgBBody = await orgBRes.json();

    // orgA should have our 4 test sessions on top of seed data
    expect(orgABody.sessions_by_status.completed).toBeGreaterThanOrEqual(3);
    expect(orgABody.sessions_by_status.abandoned).toBeGreaterThanOrEqual(1);

    // orgA should have strictly more total sessions than orgB
    // (both orgs have ~300 seed sessions, but our test adds 4 only to orgA)
    expect(orgABody.total_sessions).toBeGreaterThan(orgBBody.total_sessions);
  });

  test("org B trends do not include org A sessions", async () => {
    const [orgARes, orgBRes] = await Promise.all([
      request(
        `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
        { headers: orgAAdminHeaders },
      ),
      request(
        `/api/analytics/trends?metric=sessions&granularity=day&from_date=${FROM}&to_date=${TO}`,
        { headers: orgBAdminHeaders },
      ),
    ]);

    const orgABody = await orgARes.json();
    const orgBBody = await orgBRes.json();

    const orgATotal = orgABody.data.reduce(
      (sum: number, p: { value: number }) => sum + p.value,
      0,
    );
    const orgBTotal = orgBBody.data.reduce(
      (sum: number, p: { value: number }) => sum + p.value,
      0,
    );

    // org A should have strictly more sessions than org B
    expect(orgATotal).toBeGreaterThan(orgBTotal);
  });
});

// ============================================================================
// Golden dataset — deterministic exact-value assertions
// ============================================================================

describe("golden dataset", () => {
  // Isolated date range that doesn't overlap with seed data (which uses current date)
  const GOLDEN_FROM = "2025-06-01";
  const GOLDEN_TO = "2025-06-03";

  // --- Seed constants (hand-calculable expected values) ---

  // 4 sessions total
  const TOTAL_SESSIONS = 4;
  const COMPLETED = 3;
  const ABANDONED = 1;
  const ACTIVE = 0;

  // Channel distribution: 2 voice, 2 web
  const VOICE = 2;
  const WEB = 2;

  // Durations: only completed sessions with endedAt contribute
  // Session 1: 3600s, Session 2: 1800s, Session 3: 7200s
  const DURATION_SUM = 3600 + 1800 + 7200;
  const DURATION_COUNT = 3;

  // Feedback:
  // Session 1: customer=positive(2), support=positive(2)
  // Session 2: customer=negative(1)
  // Session 3: no feedback
  // Session 4: no feedback
  const CUSTOMER_FEEDBACK_COUNT = 2;
  const SUPPORT_FEEDBACK_COUNT = 1;
  const CUSTOMER_POSITIVE = 1; // Only session 1 has positive customer
  const SUPPORT_POSITIVE = 1;

  // Messages (user+assistant only):
  // Session 1: 2 messages (1 user, 1 assistant)
  // Session 2: 4 messages (2 user, 2 assistant)
  // Sessions 3 & 4: 0 messages
  // avg_messages_per_session = avg over sessions that HAVE messages = (2+4)/2 = 3.0
  const SESSIONS_WITH_MSGS = 2;
  const MSG_TOTAL = 6; // 2 + 4

  // Sessions with customer feedback: session 1 and session 2 = 2
  const SESSIONS_WITH_CUSTOMER_FEEDBACK = 2;

  // Expected computed values
  const EXPECTED_RESOLUTION_RATE = COMPLETED / TOTAL_SESSIONS; // 0.75
  const EXPECTED_ABANDONMENT_RATE = ABANDONED / TOTAL_SESSIONS; // 0.25
  const EXPECTED_AVG_DURATION = DURATION_SUM / DURATION_COUNT; // 4200.0
  const EXPECTED_CSAT = CUSTOMER_POSITIVE / CUSTOMER_FEEDBACK_COUNT; // 0.5
  const EXPECTED_SUPPORT_SCORE = SUPPORT_POSITIVE / SUPPORT_FEEDBACK_COUNT; // 1.0
  const EXPECTED_AVG_MESSAGES = MSG_TOTAL / SESSIONS_WITH_MSGS; // 3.0
  const EXPECTED_FEEDBACK_COVERAGE =
    SESSIONS_WITH_CUSTOMER_FEEDBACK / TOTAL_SESSIONS; // 0.5

  // Daily session counts for trends: June 1 = 1, June 2 = 2, June 3 = 1
  const DAILY_COUNTS = [1, 2, 1];

  let goldenHeaders: Record<string, string>;
  const goldenSessionIds: string[] = [];

  beforeAll(async () => {
    const seed = await getTestSeed();
    goldenHeaders = await authHeadersFor(seed.orgAAdmin);

    await forApp(async (tx) => {
      // Clean any leftover data in the golden date range first
      const existing = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, seed.orgA.id),
            gte(sessions.startedAt, new Date("2025-06-01T00:00:00Z")),
            lt(sessions.startedAt, new Date("2025-06-04T00:00:00Z")),
          ),
        );
      for (const row of existing) {
        await tx.delete(sessions).where(eq(sessions.id, row.id));
      }

      // Session 1: completed, voice, June 1, 3600s duration
      // Session 2: completed, web, June 2, 1800s duration
      // Session 3: completed, voice, June 2, 7200s duration
      // Session 4: abandoned, web, June 3, no endedAt
      const inserted = await tx
        .insert(sessions)
        .values([
          {
            organizationId: seed.orgA.id,
            agentId: seed.orgAAgentId,
            channelType: "voice",
            status: "completed",
            startedAt: new Date("2025-06-01T10:00:00Z"),
            endedAt: new Date("2025-06-01T11:00:00Z"), // 3600s
          },
          {
            organizationId: seed.orgA.id,
            agentId: seed.orgAAgentId,
            channelType: "web",
            status: "completed",
            startedAt: new Date("2025-06-02T08:00:00Z"),
            endedAt: new Date("2025-06-02T08:30:00Z"), // 1800s
          },
          {
            organizationId: seed.orgA.id,
            agentId: seed.orgAAgentId,
            channelType: "voice",
            status: "completed",
            startedAt: new Date("2025-06-02T14:00:00Z"),
            endedAt: new Date("2025-06-02T16:00:00Z"), // 7200s
          },
          {
            organizationId: seed.orgA.id,
            agentId: seed.orgAAgentId,
            channelType: "web",
            status: "abandoned",
            startedAt: new Date("2025-06-03T09:00:00Z"),
            endedAt: null,
          },
        ])
        .returning();

      for (const s of inserted) goldenSessionIds.push(s.id);

      // Feedback
      await tx.insert(sessionFeedback).values([
        {
          sessionId: inserted[0].id,
          rating: 2, // positive
          feedbackSource: "customer",
          userIdentifier: "golden-customer-1",
        },
        {
          sessionId: inserted[0].id,
          rating: 2, // positive
          feedbackSource: "support",
          userIdentifier: "golden-support-1",
        },
        {
          sessionId: inserted[1].id,
          rating: 1, // negative
          feedbackSource: "customer",
          userIdentifier: "golden-customer-2",
        },
      ]);

      // Messages (only user + assistant count toward avg_messages_per_session)
      await tx.insert(sessionMessages).values([
        // Session 1: 1 user + 1 assistant = 2 counted
        { sessionId: inserted[0].id, role: "user", content: "golden-msg-1" },
        {
          sessionId: inserted[0].id,
          role: "assistant",
          content: "golden-msg-2",
        },
        // Session 2: 2 user + 2 assistant = 4 counted
        { sessionId: inserted[1].id, role: "user", content: "golden-msg-3" },
        {
          sessionId: inserted[1].id,
          role: "assistant",
          content: "golden-msg-4",
        },
        { sessionId: inserted[1].id, role: "user", content: "golden-msg-5" },
        {
          sessionId: inserted[1].id,
          role: "assistant",
          content: "golden-msg-6",
        },
      ]);
    });
  });

  afterAll(async () => {
    if (goldenSessionIds.length > 0) {
      await forApp(async (tx) => {
        for (const id of goldenSessionIds) {
          await tx.delete(sessions).where(eq(sessions.id, id));
        }
      });
    }
  });

  // ---------- Summary ----------

  test("GET /api/analytics returns exact summary values", async () => {
    const response = await request(
      `/api/analytics?from_date=${GOLDEN_FROM}&to_date=${GOLDEN_TO}`,
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total_sessions).toBe(TOTAL_SESSIONS);
    expect(body.sessions_by_status).toEqual({
      active: ACTIVE,
      completed: COMPLETED,
      abandoned: ABANDONED,
    });
    expect(body.sessions_by_channel.voice).toBe(VOICE);
    expect(body.sessions_by_channel.web).toBe(WEB);
    expect(body.sessions_by_channel.api).toBe(0);
    expect(body.sessions_by_channel.slack).toBe(0);

    expect(body.resolution_rate).toBe(EXPECTED_RESOLUTION_RATE);
    expect(body.abandonment_rate).toBe(EXPECTED_ABANDONMENT_RATE);
    expect(body.avg_duration_seconds).toBe(EXPECTED_AVG_DURATION);
    expect(body.csat_score).toBe(EXPECTED_CSAT);
    expect(body.support_evaluation_score).toBe(EXPECTED_SUPPORT_SCORE);
    expect(body.avg_messages_per_session).toBe(EXPECTED_AVG_MESSAGES);
    expect(body.feedback_coverage_rate).toBe(EXPECTED_FEEDBACK_COVERAGE);
    expect(body.feedback_count).toEqual({
      customer: CUSTOMER_FEEDBACK_COUNT,
      support: SUPPORT_FEEDBACK_COUNT,
    });

    // No NaN anywhere
    for (const [_key, value] of Object.entries(body)) {
      if (typeof value === "number") {
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });

  // ---------- Previous period ----------

  test("previous period contains zeros for mirror period with no data", async () => {
    const response = await request(
      `/api/analytics?from_date=${GOLDEN_FROM}&to_date=${GOLDEN_TO}`,
      { headers: goldenHeaders },
    );

    const body = await response.json();

    // from_date=2025-06-01, to_date=2025-06-03 → endOfDay → toDate=2025-06-04
    // Period span = 4 days. Previous: 2025-05-28 → 2025-06-01 (no data)
    expect(body.previous_period).not.toBeNull();
    expect(body.previous_period.total_sessions).toBe(0);
    expect(body.previous_period.resolution_rate).toBe(0);
    expect(body.previous_period.abandonment_rate).toBe(0);
    expect(body.previous_period.avg_duration_seconds).toBeNull();
    expect(body.previous_period.csat_score).toBeNull();
    expect(body.previous_period.avg_messages_per_session).toBeNull();
    expect(body.previous_period.feedback_coverage_rate).toBe(0);
  });

  test("1-day range produces correct previous period", async () => {
    // from_date=2025-06-01&to_date=2025-06-01 → endOfDay → 1-day span
    // Previous: 1 day back → 2025-05-31 to 2025-06-01
    const response = await request(
      "/api/analytics?from_date=2025-06-01&to_date=2025-06-01",
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    // 1 session on June 1
    expect(body.total_sessions).toBe(1);
    expect(body.previous_period).not.toBeNull();
    expect(body.previous_period.total_sessions).toBe(0);
  });

  // ---------- Agent performance ----------

  test("GET /api/analytics/agents returns exact per-agent metrics", async () => {
    const response = await request(
      `/api/analytics/agents?from_date=${GOLDEN_FROM}&to_date=${GOLDEN_TO}`,
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.agents.length).toBe(1);
    const agent = body.agents[0];

    expect(agent.total_sessions).toBe(TOTAL_SESSIONS);
    expect(agent.resolution_rate).toBe(EXPECTED_RESOLUTION_RATE);
    // avg_duration from agent query: (3600+1800+7200)/3 = 4200
    expect(agent.avg_duration_seconds).toBe(EXPECTED_AVG_DURATION);
    // CSAT per agent: same as global (only 1 agent)
    expect(agent.csat_score).toBe(EXPECTED_CSAT);
  });

  // ---------- Trends ----------

  test("GET /api/analytics/trends returns exact daily session counts", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=day&from_date=${GOLDEN_FROM}&to_date=${GOLDEN_TO}`,
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.metric).toBe("sessions");
    expect(body.granularity).toBe("day");
    expect(body.data).toHaveLength(3);

    // Sort by date to ensure order
    const sorted = [...body.data].sort(
      (a: { date: string }, b: { date: string }) =>
        a.date.localeCompare(b.date),
    );
    expect(sorted[0].value).toBe(DAILY_COUNTS[0]); // June 1: 1
    expect(sorted[1].value).toBe(DAILY_COUNTS[1]); // June 2: 2
    expect(sorted[2].value).toBe(DAILY_COUNTS[2]); // June 3: 1
  });

  // ---------- Granularity validation ----------

  test("hourly granularity with >7 day range returns 422", async () => {
    const response = await request(
      "/api/analytics/trends?metric=sessions&granularity=hour&from_date=2025-06-01&to_date=2025-06-15",
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(422);
  });

  test("hourly granularity with <=7 day range returns 200", async () => {
    const response = await request(
      `/api/analytics/trends?metric=sessions&granularity=hour&from_date=${GOLDEN_FROM}&to_date=${GOLDEN_TO}`,
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.granularity).toBe("hour");
  });

  // ---------- Regression: empty range returns zeros, never NaN ----------

  test("empty date range returns all zeros and no NaN", async () => {
    const response = await request(
      "/api/analytics?from_date=2099-06-01&to_date=2099-06-03",
      { headers: goldenHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total_sessions).toBe(0);
    expect(body.resolution_rate).toBe(0);
    expect(body.abandonment_rate).toBe(0);
    expect(body.avg_duration_seconds).toBeNull();
    expect(body.csat_score).toBeNull();
    expect(body.support_evaluation_score).toBeNull();
    expect(body.avg_messages_per_session).toBeNull();
    expect(body.feedback_coverage_rate).toBe(0);

    // Verify no NaN in any numeric field
    const values = [
      body.total_sessions,
      body.resolution_rate,
      body.abandonment_rate,
      body.feedback_coverage_rate,
    ];
    for (const v of values) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});
