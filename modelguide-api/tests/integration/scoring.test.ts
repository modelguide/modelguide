/**
 * Integration tests for scoring calculations
 * Tests CSAT scores, support evaluation scores, rate calculations,
 * and feedback aggregation through the analytics API.
 *
 * Uses a narrow future date window (2098-06-*) to isolate test data
 * from seed data and other test suites.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { sessionFeedback, sessions } from "@db/schema";
import { eq } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let headers: Record<string, string>;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/** Query analytics summary for the isolated test window */
async function getSummary(extra = "", hdrs: Record<string, string> = headers) {
  const res = await request(
    `/api/analytics?from_date=2098-06-01&to_date=2098-06-30${extra}`,
    { headers: hdrs },
  );
  expect(res.status).toBe(200);
  return res.json();
}

/** Query analytics trends for the isolated test window */
async function getTrends(metric: string, granularity = "day", extra = "") {
  const res = await request(
    `/api/analytics/trends?metric=${metric}&granularity=${granularity}&from_date=2098-06-01&to_date=2098-06-30${extra}`,
    { headers },
  );
  expect(res.status).toBe(200);
  return res.json();
}

// ============================================================================
// Setup — create deterministic sessions and feedback in 2098-06
// ============================================================================

beforeAll(async () => {
  s = await getTestSeed();
  headers = await authHeadersFor(s.orgAAdmin);

  const base = new Date("2098-06-15T12:00:00Z");
  const baseEnd = new Date("2098-06-15T12:30:00Z"); // 30 min sessions

  await forApp(async (tx) => {
    // 6 sessions total:
    //   4 completed, 1 abandoned, 1 active
    const inserted = await tx
      .insert(sessions)
      .values([
        {
          // [0] completed, voice
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "voice",
          status: "completed",
          startedAt: base,
          endedAt: baseEnd,
        },
        {
          // [1] completed, web
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "web",
          status: "completed",
          startedAt: base,
          endedAt: baseEnd,
        },
        {
          // [2] completed, voice
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "voice",
          status: "completed",
          startedAt: base,
          endedAt: baseEnd,
        },
        {
          // [3] completed, web
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "web",
          status: "completed",
          startedAt: base,
          endedAt: baseEnd,
        },
        {
          // [4] abandoned, voice
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "voice",
          status: "abandoned",
          startedAt: base,
          endedAt: baseEnd,
        },
        {
          // [5] active, web (no endedAt)
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "web",
          status: "active",
          startedAt: base,
        },
      ])
      .returning();

    for (const session of inserted) {
      createdSessionIds.push(session.id);
    }

    // Customer feedback: 3 positive, 1 negative → CSAT = 3/4 = 0.75
    // Support feedback:  1 positive, 1 negative → Support = 1/2 = 0.5
    await tx.insert(sessionFeedback).values([
      // Session 0: customer positive + support positive
      {
        sessionId: inserted[0].id,
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "scoring-cust-1",
      },
      {
        sessionId: inserted[0].id,
        rating: 2,
        feedbackSource: "support",
        userIdentifier: "scoring-support-1",
      },
      // Session 1: customer positive
      {
        sessionId: inserted[1].id,
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "scoring-cust-2",
      },
      // Session 2: customer negative + support negative
      {
        sessionId: inserted[2].id,
        rating: 1,
        feedbackSource: "customer",
        userIdentifier: "scoring-cust-3",
      },
      {
        sessionId: inserted[2].id,
        rating: 1,
        feedbackSource: "support",
        userIdentifier: "scoring-support-2",
      },
      // Session 3 (completed): customer positive
      {
        sessionId: inserted[3].id,
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "scoring-cust-4",
      },
    ]);
  });
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
// CSAT score
// ============================================================================

describe("CSAT score calculation", () => {
  test("computes CSAT as positive customer ratings / total customer ratings", async () => {
    const body = await getSummary();

    // 3 positive out of 4 customer ratings = 0.75
    expect(body.csat_score).toBe(0.75);
  });

  test("only counts customer source feedback for CSAT", async () => {
    const body = await getSummary();

    // Support feedback (2 entries) should not affect CSAT
    // CSAT is strictly from feedbackSource='customer'
    expect(body.feedback_count.customer).toBe(4);
    expect(body.csat_score).toBe(0.75);
  });

  test("returns null CSAT when no customer feedback exists", async () => {
    // Query a date range with no data
    const res = await request(
      "/api/analytics?from_date=2097-01-01&to_date=2097-01-31",
      { headers },
    );
    const body = await res.json();

    expect(body.csat_score).toBeNull();
  });
});

// ============================================================================
// Support evaluation score
// ============================================================================

describe("Support evaluation score calculation", () => {
  test("computes support score as positive support ratings / total support ratings", async () => {
    const body = await getSummary();

    // 1 positive out of 2 support ratings = 0.5
    expect(body.support_evaluation_score).toBe(0.5);
  });

  test("only counts support source feedback for support score", async () => {
    const body = await getSummary();

    expect(body.feedback_count.support).toBe(2);
    expect(body.support_evaluation_score).toBe(0.5);
  });

  test("returns null support score when no support feedback exists", async () => {
    const res = await request(
      "/api/analytics?from_date=2097-01-01&to_date=2097-01-31",
      { headers },
    );
    const body = await res.json();

    expect(body.support_evaluation_score).toBeNull();
  });
});

// ============================================================================
// Feedback counts
// ============================================================================

describe("Feedback counts", () => {
  test("returns accurate counts by feedback source", async () => {
    const body = await getSummary();

    expect(body.feedback_count.customer).toBe(4);
    expect(body.feedback_count.support).toBe(2);
  });

  test("returns zero counts when no feedback exists in range", async () => {
    const res = await request(
      "/api/analytics?from_date=2097-01-01&to_date=2097-01-31",
      { headers },
    );
    const body = await res.json();

    expect(body.feedback_count.customer).toBe(0);
    expect(body.feedback_count.support).toBe(0);
  });
});

// ============================================================================
// Status-based rates (resolution, abandonment)
// ============================================================================

describe("Rate calculations", () => {
  test("computes resolution rate as completed / total", async () => {
    const body = await getSummary();

    // 4 completed out of 6 total ≈ 0.6667
    expect(body.resolution_rate).toBeCloseTo(4 / 6, 4);
  });

  test("computes abandonment rate as abandoned / total", async () => {
    const body = await getSummary();

    // 1 abandoned out of 6 total ≈ 0.1667
    expect(body.abandonment_rate).toBeCloseTo(1 / 6, 4);
  });

  test("rates sum to <= 1 (active sessions make up remainder)", async () => {
    const body = await getSummary();

    const sum = body.resolution_rate + body.abandonment_rate;
    // 4/6 + 1/6 = 5/6 ≈ 0.8333 (1 active session remains)
    expect(sum).toBeLessThanOrEqual(1);
    // Individual rates are rounded to 4 decimals, so summing them
    // may differ slightly from the exact fraction
    expect(sum).toBeCloseTo(5 / 6, 3);
  });

  test("returns zero rates when no sessions exist in range", async () => {
    const res = await request(
      "/api/analytics?from_date=2097-01-01&to_date=2097-01-31",
      { headers },
    );
    const body = await res.json();

    expect(body.resolution_rate).toBe(0);
    expect(body.abandonment_rate).toBe(0);
  });
});

// ============================================================================
// Average duration
// ============================================================================

describe("Average duration", () => {
  test("computes avg duration from sessions with endedAt", async () => {
    const body = await getSummary();

    // 5 sessions have endedAt (30 min = 1800s each), 1 active has no endedAt
    expect(body.avg_duration_seconds).toBe(1800);
  });

  test("returns null when no sessions have endedAt", async () => {
    const res = await request(
      "/api/analytics?from_date=2097-01-01&to_date=2097-01-31",
      { headers },
    );
    const body = await res.json();

    expect(body.avg_duration_seconds).toBeNull();
  });
});

// ============================================================================
// Session counts and channel breakdown
// ============================================================================

describe("Session counts", () => {
  test("reports correct total sessions", async () => {
    const body = await getSummary();

    expect(body.total_sessions).toBe(6);
  });

  test("breaks down sessions by status correctly", async () => {
    const body = await getSummary();

    expect(body.sessions_by_status.completed).toBe(4);
    expect(body.sessions_by_status.abandoned).toBe(1);
    expect(body.sessions_by_status.active).toBe(1);
  });

  test("breaks down sessions by channel correctly", async () => {
    const body = await getSummary();

    // 3 voice, 3 web
    expect(body.sessions_by_channel.voice).toBe(3);
    expect(body.sessions_by_channel.web).toBe(3);
    expect(body.sessions_by_channel.api).toBe(0);
    expect(body.sessions_by_channel.slack).toBe(0);
  });
});

// ============================================================================
// Filtering affects scores
// ============================================================================

describe("Filtered scoring", () => {
  test("channel filter recalculates CSAT for filtered sessions only", async () => {
    // Voice sessions: [0] rating=2 customer, [2] rating=1 customer, [4] no feedback
    // → 1 positive out of 2 customer = 0.5
    const body = await getSummary("&channel_type=voice");

    expect(body.csat_score).toBe(0.5);
    expect(body.feedback_count.customer).toBe(2);
  });

  test("channel filter recalculates rates for filtered sessions only", async () => {
    // Voice: 2 completed, 1 abandoned = 3 total
    const body = await getSummary("&channel_type=voice");

    expect(body.total_sessions).toBe(3);
    expect(body.resolution_rate).toBeCloseTo(2 / 3, 4);
    expect(body.abandonment_rate).toBeCloseTo(1 / 3, 4);
  });

  test("agent filter scopes to specific agent", async () => {
    const body = await getSummary(`&agent_id=${s.orgAAgentId}`);

    // All our test sessions use orgAAgentId
    expect(body.total_sessions).toBe(6);
  });
});

// ============================================================================
// CSAT trend
// ============================================================================

describe("CSAT trend", () => {
  test("returns CSAT trend data points", async () => {
    const body = await getTrends("csat");

    expect(body.metric).toBe("csat");
    expect(body.granularity).toBe("day");
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("CSAT trend value matches summary CSAT", async () => {
    // All sessions are on the same day, so there should be 1 data point
    const body = await getTrends("csat");

    expect(body.data.length).toBe(1);
    // CSAT trend uses customer feedback only: 3 positive / 4 total = 0.75
    expect(body.data[0].value).toBe(0.75);
  });

  test("returns empty CSAT trend for range with no feedback", async () => {
    const res = await request(
      "/api/analytics/trends?metric=csat&granularity=day&from_date=2097-01-01&to_date=2097-01-31",
      { headers },
    );
    const body = await res.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBe(0);
  });
});

// ============================================================================
// Resolution rate trend
// ============================================================================

describe("Resolution rate trend", () => {
  test("returns resolution rate matching summary", async () => {
    const body = await getTrends("resolution_rate");

    expect(body.data.length).toBe(1);
    // 4 completed / 6 total ≈ 0.6667
    expect(body.data[0].value).toBeCloseTo(4 / 6, 4);
  });
});

// ============================================================================
// Duration trend
// ============================================================================

describe("Duration trend", () => {
  test("returns average duration in seconds", async () => {
    const body = await getTrends("duration");

    expect(body.data.length).toBe(1);
    // All sessions with endedAt have 30 min = 1800s
    expect(body.data[0].value).toBe(1800);
  });
});

// ============================================================================
// Sessions trend
// ============================================================================

describe("Sessions trend", () => {
  test("returns session count per bucket", async () => {
    const body = await getTrends("sessions");

    expect(body.data.length).toBe(1);
    expect(body.data[0].value).toBe(6);
  });

  test("granularity=month groups all sessions into one bucket", async () => {
    const body = await getTrends("sessions", "month");

    expect(body.data.length).toBe(1);
    expect(body.data[0].value).toBe(6);
  });
});

// ============================================================================
// Feedback on session detail
// ============================================================================

describe("Feedback in session detail", () => {
  test("session detail includes feedback array", async () => {
    // Session[0] has 2 feedback entries (customer + support)
    const res = await request(`/api/sessions/${createdSessionIds[0]}`, {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.feedback).toBeArray();
    expect(body.feedback.length).toBe(2);

    const sources = body.feedback.map(
      (f: { feedbackSource: string }) => f.feedbackSource,
    );
    expect(sources).toContain("customer");
    expect(sources).toContain("support");
  });

  test("feedback entries have correct rating values", async () => {
    const res = await request(`/api/sessions/${createdSessionIds[0]}`, {
      headers,
    });
    const body = await res.json();

    const customerFeedback = body.feedback.find(
      (f: { feedbackSource: string }) => f.feedbackSource === "customer",
    );
    const supportFeedback = body.feedback.find(
      (f: { feedbackSource: string }) => f.feedbackSource === "support",
    );

    expect(customerFeedback.rating).toBe(2);
    expect(supportFeedback.rating).toBe(2);
  });

  test("session without feedback has empty feedback array", async () => {
    // Session[4] (abandoned) has no feedback
    const res = await request(`/api/sessions/${createdSessionIds[4]}`, {
      headers,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.feedback).toBeArray();
    expect(body.feedback.length).toBe(0);
  });
});

// ============================================================================
// Multiple feedback per session
// ============================================================================

describe("Multiple feedback per session", () => {
  test("a session can have both customer and support feedback", async () => {
    const body = await getSummary();

    // Session[0] has both customer and support feedback,
    // Session[2] also has both — this doesn't break scoring
    expect(body.csat_score).toBe(0.75);
    expect(body.support_evaluation_score).toBe(0.5);
  });
});

// ============================================================================
// Edge case: all positive / all negative
// ============================================================================

describe("Score edge cases", () => {
  const edgeCaseSessionIds: string[] = [];

  afterAll(async () => {
    if (edgeCaseSessionIds.length > 0) {
      await forApp(async (tx) => {
        for (const id of edgeCaseSessionIds) {
          await tx.delete(sessions).where(eq(sessions.id, id));
        }
      });
    }
  });

  test("CSAT is 1.0 when all customer feedback is positive", async () => {
    // Create isolated sessions in 2097-03
    await forApp(async (tx) => {
      const inserted = await tx
        .insert(sessions)
        .values([
          {
            organizationId: s.orgA.id,
            agentId: s.orgAAgentId,
            channelType: "web",
            status: "completed",
            startedAt: new Date("2097-03-15T10:00:00Z"),
            endedAt: new Date("2097-03-15T10:30:00Z"),
          },
          {
            organizationId: s.orgA.id,
            agentId: s.orgAAgentId,
            channelType: "web",
            status: "completed",
            startedAt: new Date("2097-03-15T11:00:00Z"),
            endedAt: new Date("2097-03-15T11:30:00Z"),
          },
        ])
        .returning();

      for (const session of inserted) {
        edgeCaseSessionIds.push(session.id);
        createdSessionIds.push(session.id);
      }

      await tx.insert(sessionFeedback).values([
        {
          sessionId: inserted[0].id,
          rating: 2,
          feedbackSource: "customer",
          userIdentifier: "edge-all-pos-1",
        },
        {
          sessionId: inserted[1].id,
          rating: 2,
          feedbackSource: "customer",
          userIdentifier: "edge-all-pos-2",
        },
      ]);
    });

    const res = await request(
      "/api/analytics?from_date=2097-03-01&to_date=2097-03-31",
      { headers },
    );
    const body = await res.json();

    expect(body.csat_score).toBe(1);
    expect(body.feedback_count.customer).toBe(2);
  });

  test("CSAT is 0.0 when all customer feedback is negative", async () => {
    // Create isolated sessions in 2097-04
    await forApp(async (tx) => {
      const inserted = await tx
        .insert(sessions)
        .values([
          {
            organizationId: s.orgA.id,
            agentId: s.orgAAgentId,
            channelType: "web",
            status: "completed",
            startedAt: new Date("2097-04-15T10:00:00Z"),
            endedAt: new Date("2097-04-15T10:30:00Z"),
          },
          {
            organizationId: s.orgA.id,
            agentId: s.orgAAgentId,
            channelType: "web",
            status: "completed",
            startedAt: new Date("2097-04-15T11:00:00Z"),
            endedAt: new Date("2097-04-15T11:30:00Z"),
          },
        ])
        .returning();

      for (const session of inserted) {
        edgeCaseSessionIds.push(session.id);
        createdSessionIds.push(session.id);
      }

      await tx.insert(sessionFeedback).values([
        {
          sessionId: inserted[0].id,
          rating: 1,
          feedbackSource: "customer",
          userIdentifier: "edge-all-neg-1",
        },
        {
          sessionId: inserted[1].id,
          rating: 1,
          feedbackSource: "customer",
          userIdentifier: "edge-all-neg-2",
        },
      ]);
    });

    const res = await request(
      "/api/analytics?from_date=2097-04-01&to_date=2097-04-30",
      { headers },
    );
    const body = await res.json();

    // 0 positive / 2 total = 0.0 — a genuine 0% score is returned as 0 (not null)
    // null is reserved for "no feedback data at all"
    expect(body.csat_score).toBe(0);
    expect(body.feedback_count.customer).toBe(2);
  });

  test("single feedback entry produces valid score", async () => {
    // Create isolated session in 2097-05
    await forApp(async (tx) => {
      const [session] = await tx
        .insert(sessions)
        .values({
          organizationId: s.orgA.id,
          agentId: s.orgAAgentId,
          channelType: "web",
          status: "completed",
          startedAt: new Date("2097-05-15T10:00:00Z"),
          endedAt: new Date("2097-05-15T10:30:00Z"),
        })
        .returning();

      edgeCaseSessionIds.push(session.id);
      createdSessionIds.push(session.id);

      await tx.insert(sessionFeedback).values({
        sessionId: session.id,
        rating: 2,
        feedbackSource: "customer",
        userIdentifier: "edge-single",
      });
    });

    const res = await request(
      "/api/analytics?from_date=2097-05-01&to_date=2097-05-31",
      { headers },
    );
    const body = await res.json();

    // 1 positive / 1 total = 1.0
    expect(body.csat_score).toBe(1);
    expect(body.feedback_count.customer).toBe(1);
    expect(body.support_evaluation_score).toBeNull();
    expect(body.feedback_count.support).toBe(0);
  });
});
