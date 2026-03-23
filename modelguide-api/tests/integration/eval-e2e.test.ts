/**
 * End-to-end evaluation scenario tests.
 *
 * Scenarios that tested the removed POST /api/evals/runs route have been
 * removed. Eval runs are now triggered via eval suites.
 *
 * Remaining scenarios:
 *   S4: evalConfigId lifecycle — SOP CRUD round-trip + delete guard
 *   S6: List and filter runs (via direct DB insert)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp, forOrg } from "@db/rls";
import {
  connectorTools,
  connectors,
  evalConfigs,
  evalRunScores,
  evalRuns,
  sessions,
  sops,
} from "@db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

// ============================================================================
// Setup
// ============================================================================

let s: TestSeed;
let adminHeaders: Record<string, string>;
let agentHeaders: Record<string, string>;

/** Resolved connector tool info from seed data */
let getOrderToolId: string;

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

/** Create a completed session via agent API. Returns session ID. */
async function buildSession(): Promise<string> {
  const res = await post("/api/sessions", agentHeaders, {
    channelType: "web",
    userIdentifier: `e2e-${Date.now()}@test.com`,
  });
  const session = await res.json();
  cleanupSessionIds.push(session.id);

  await post(`/api/sessions/${session.id}/messages`, agentHeaders, {
    role: "user",
    content: "Hello",
  });

  await post(`/api/sessions/${session.id}/messages`, agentHeaders, {
    role: "assistant",
    content: "Hi there!",
  });

  await req(`/api/sessions/${session.id}`, {
    method: "PATCH",
    headers: agentHeaders,
    body: JSON.stringify({ status: "completed" }),
  });

  return session.id;
}

/**
 * Insert an eval run directly into the DB (the POST route was removed).
 */
async function insertEvalRun(
  orgId: string,
  sessionId: string,
  sourceId: string,
  opts?: { triggeredBy?: string; passed?: boolean },
): Promise<string> {
  const [run] = await forOrg(orgId, async (tx) =>
    tx
      .insert(evalRuns)
      .values({
        organizationId: orgId,
        sessionId,
        sourceType: "suite",
        sourceId,
        status: "completed",
        passed: opts?.passed ?? true,
        durationMs: 42,
        triggeredBy: opts?.triggeredBy ?? null,
        completedAt: new Date(),
      })
      .returning(),
  );
  cleanupRunIds.push(run.id);
  return run.id;
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
      slug: "s4-lifecycle-sop",
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
// Scenario 6: List and filter runs (eval runs created via direct DB insert)
// ============================================================================

describe("Scenario 6: list and filter runs", () => {
  let targetSopId: string;

  test("6-setup. create SOP and eval runs via DB insert", async () => {
    const sopRes = await post("/api/sops", adminHeaders, {
      name: "S6: Filter Test SOP",
      slug: "s6-filter-test-sop",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          { id: "s1", order: 1, instruction: "Step one", required: true },
        ],
        metadata: {},
      },
    });
    targetSopId = (await sopRes.json()).id;
    cleanupSopIds.push(targetSopId);

    // Create two sessions and eval runs linked to this SOP
    const sessionId1 = await buildSession();
    const sessionId2 = await buildSession();
    await insertEvalRun(s.orgA.id, sessionId1, targetSopId, {
      triggeredBy: s.orgAAdmin.id,
    });
    await insertEvalRun(s.orgA.id, sessionId2, targetSopId, {
      triggeredBy: s.orgAAdmin.id,
      passed: false,
    });
  });

  test("6a. filter by sourceId returns only matching runs", async () => {
    const r = await req(
      `/api/evals/runs?sourceId=${targetSopId}&page=1&pageSize=50`,
      { headers: adminHeaders },
    );
    expect(r.status).toBe(200);
    const body = await r.json();

    expect(body.data.length).toBeGreaterThanOrEqual(2);
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
