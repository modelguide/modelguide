/**
 * Security, auth, immutability, and zero-config edge-case tests for the eval engine.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import {
  evalConfigs,
  evalRunScores,
  evalRuns,
  sessions,
  sops,
} from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let orgAAgentHeaders: Record<string, string>;

const createdSessionIds: string[] = [];
const createdSopIds: string[] = [];
const createdEvalConfigIds: string[] = [];
const createdEvalRunIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

async function createCompletedSession(): Promise<string> {
  const createRes = await request("/api/sessions", {
    method: "POST",
    headers: orgAAgentHeaders,
    body: JSON.stringify({
      channelType: "web",
      customer: { email: "security-test@example.com" },
    }),
  });
  const session = await createRes.json();
  createdSessionIds.push(session.id);

  await request(`/api/sessions/${session.id}/messages`, {
    method: "POST",
    headers: orgAAgentHeaders,
    body: JSON.stringify({ role: "user", content: "Hello" }),
  });

  await request(`/api/sessions/${session.id}/messages`, {
    method: "POST",
    headers: orgAAgentHeaders,
    body: JSON.stringify({ role: "assistant", content: "Hi there!" }),
  });

  await request(`/api/sessions/${session.id}`, {
    method: "PATCH",
    headers: orgAAgentHeaders,
    body: JSON.stringify({ status: "completed" }),
  });

  return session.id;
}

beforeAll(async () => {
  s = await getTestSeed();
  [orgAAdminHeaders, orgBAdminHeaders, orgAAgentHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    authHeadersFor(s.orgBAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
  ]);
});

afterAll(async () => {
  await forApp(async (tx) => {
    if (createdEvalRunIds.length > 0) {
      await tx
        .delete(evalRunScores)
        .where(inArray(evalRunScores.evalRunId, createdEvalRunIds));
      await tx.delete(evalRuns).where(inArray(evalRuns.id, createdEvalRunIds));
    }
    for (const id of createdSessionIds) {
      await tx.delete(sessions).where(eq(sessions.id, id));
    }
    if (createdSopIds.length > 0) {
      await tx.delete(sops).where(inArray(sops.id, createdSopIds));
    }
    if (createdEvalConfigIds.length > 0) {
      await tx
        .delete(evalConfigs)
        .where(inArray(evalConfigs.id, createdEvalConfigIds));
    }
  });
});

// ============================================================================
// Security & Auth
// ============================================================================

describe("Eval security & auth", () => {
  test("cross-org eval trigger: orgB admin on orgA session → 404 (RLS)", async () => {
    const sessionId = await createCompletedSession();

    // Create a SOP in orgA
    const sopRes = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Security test SOP",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            { id: "s1", order: 1, instruction: "Do something", required: true },
          ],
          metadata: {},
        },
      }),
    });
    const sop = await sopRes.json();
    createdSopIds.push(sop.id);

    // orgB tries to eval orgA session → should 404
    const response = await request("/api/evals/runs", {
      method: "POST",
      headers: orgBAdminHeaders,
      body: JSON.stringify({
        sessionId,
        sourceType: "sop",
        sourceId: sop.id,
      }),
    });

    expect(response.status).toBe(404);
  });

  test("eval run immutability: DELETE /api/evals/runs/:runId → 404 (no route)", async () => {
    const response = await request(
      "/api/evals/runs/00000000-0000-0000-0000-000000000001",
      {
        method: "DELETE",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(404);
  });

  test("unauthenticated POST /api/evals/runs → 401", async () => {
    const response = await request("/api/evals/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "00000000-0000-0000-0000-000000000001",
        sourceType: "sop",
        sourceId: "00000000-0000-0000-0000-000000000001",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("unauthenticated GET /api/evals/runs → 401", async () => {
    const response = await request("/api/evals/runs", {
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  test("invalid sourceType 'guardrail' → 422", async () => {
    const response = await request("/api/evals/runs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        sessionId: "00000000-0000-0000-0000-000000000001",
        sourceType: "guardrail",
        sourceId: "00000000-0000-0000-0000-000000000001",
      }),
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// Zero-config E2E
// ============================================================================

describe("Zero-config SOP eval", () => {
  let zeroConfigSopId: string;
  let zeroConfigRunId: string;

  test("creates SOP with 3 steps, none having evalConfigId", async () => {
    const response = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Zero-config SOP",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "zc-step-1",
              order: 1,
              instruction: "Greet the customer",
              required: true,
            },
            {
              id: "zc-step-2",
              order: 2,
              instruction: "Look up order",
              required: true,
            },
            {
              id: "zc-step-3",
              order: 3,
              instruction: "Confirm resolution",
              required: false,
            },
          ],
          metadata: {},
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    zeroConfigSopId = body.id;
    createdSopIds.push(zeroConfigSopId);
  });

  test("run eval → passed: true, 0 scores, coverageWarning, all step IDs in uncoveredSteps", async () => {
    const sessionId = await createCompletedSession();

    const response = await request("/api/evals/runs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        sessionId,
        sourceType: "sop",
        sourceId: zeroConfigSopId,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.passed).toBe(true);
    expect(body.scores).toHaveLength(0);
    expect(body.metadata).toBeDefined();
    expect(body.metadata.coverageWarning).toContain("3 of 3");
    expect(body.metadata.uncoveredSteps).toEqual(
      expect.arrayContaining(["zc-step-1", "zc-step-2", "zc-step-3"]),
    );

    zeroConfigRunId = body.id;
    createdEvalRunIds.push(zeroConfigRunId);
  });

  test("GET run by ID confirms metadata shape", async () => {
    const response = await request(`/api/evals/runs/${zeroConfigRunId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(zeroConfigRunId);
    expect(body.passed).toBe(true);
    expect(body.scores).toHaveLength(0);
    expect(body.metadata.coverageWarning).toContain("3 of 3");
    expect(body.metadata.uncoveredSteps).toHaveLength(3);
  });
});
