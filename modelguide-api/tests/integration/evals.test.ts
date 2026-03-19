/**
 * Integration tests for Eval Runs API (read-only).
 * Tests the GET endpoints for eval runs — listing and detail retrieval.
 *
 * Eval runs are created via direct DB insert since the POST /api/evals/runs
 * route has been removed (evals are now triggered via eval suites).
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

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let viewerHeaders: Record<string, string>;
let orgAAgentHeaders: Record<string, string>;

/** IDs for cleanup */
const createdSessionIds: string[] = [];
const createdSopIds: string[] = [];
const createdEvalConfigIds: string[] = [];
const createdEvalRunIds: string[] = [];

/** Test fixtures set up in beforeAll */
let sopId: string;
let toolCalledConfigId: string;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/**
 * Create a completed session via agent API.
 * Returns the session ID.
 */
async function createCompletedSession(): Promise<string> {
  const createRes = await request("/api/sessions", {
    method: "POST",
    headers: orgAAgentHeaders,
    body: JSON.stringify({
      channelType: "web",
      userIdentifier: "eval-test@example.com",
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
  createdEvalRunIds.push(run.id);
  return run.id;
}

beforeAll(async () => {
  s = await getTestSeed();
  [orgAAdminHeaders, orgBAdminHeaders, viewerHeaders, orgAAgentHeaders] =
    await Promise.all([
      authHeadersFor(s.orgAAdmin),
      authHeadersFor(s.orgBAdmin),
      authHeadersFor(s.demoViewer),
      agentHeadersFor(s.orgAAgentId, s.orgA.id),
    ]);

  // Look up the connector_tools.id for orgA's Medusa get_order
  const [tool] = await forApp(async (tx) =>
    tx
      .select({ id: connectorTools.id })
      .from(connectorTools)
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .where(
        and(
          eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
          eq(connectorTools.slug, "get_order"),
          isNull(connectorTools.deletedAt),
        ),
      ),
  );

  // Create an eval config
  const toolCalledRes = await request("/api/eval-configs", {
    method: "POST",
    headers: orgAAdminHeaders,
    body: JSON.stringify({
      name: "Check get_order called",
      evaluatorType: "tool_called",
      config: { connectorToolId: tool.id },
    }),
  });
  const toolCalledConfig = await toolCalledRes.json();
  toolCalledConfigId = toolCalledConfig.id;
  createdEvalConfigIds.push(toolCalledConfigId);

  // Create a SOP
  const sopRes = await request("/api/sops", {
    method: "POST",
    headers: orgAAdminHeaders,
    body: JSON.stringify({
      name: "Eval Test SOP - Order Lookup",
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "greet",
            order: 1,
            instruction: "Greet the customer",
            required: true,
          },
          {
            id: "lookup-order",
            order: 2,
            instruction: "Look up the order using get_order tool",
            required: true,
            evalConfigId: toolCalledConfigId,
          },
        ],
        metadata: {},
      },
    }),
  });
  const sopBody = await sopRes.json();
  sopId = sopBody.id;
  createdSopIds.push(sopId);

  // Pre-create eval runs for the GET tests
  const sessionId = await createCompletedSession();
  await insertEvalRun(s.orgA.id, sessionId, sopId, {
    triggeredBy: s.orgAAdmin.id,
  });
});

afterAll(async () => {
  await forApp(async (tx) => {
    // Delete eval run scores and runs first
    if (createdEvalRunIds.length > 0) {
      await tx
        .delete(evalRunScores)
        .where(inArray(evalRunScores.evalRunId, createdEvalRunIds));
      await tx.delete(evalRuns).where(inArray(evalRuns.id, createdEvalRunIds));
    }
    // Delete sessions (messages cascade)
    for (const id of createdSessionIds) {
      await tx.delete(sessions).where(eq(sessions.id, id));
    }
    // Delete SOPs (steps cascade)
    if (createdSopIds.length > 0) {
      await tx.delete(sops).where(inArray(sops.id, createdSopIds));
    }
    // Delete eval configs
    if (createdEvalConfigIds.length > 0) {
      await tx
        .delete(evalConfigs)
        .where(inArray(evalConfigs.id, createdEvalConfigIds));
    }
  });
});

// ============================================================================
// GET /api/evals/runs — List
// ============================================================================

describe("GET /api/evals/runs", () => {
  test("returns paginated list (200)", async () => {
    const response = await request("/api/evals/runs?page=1&pageSize=10", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by sessionId", async () => {
    const sessionId = createdSessionIds[0];
    const response = await request(`/api/evals/runs?sessionId=${sessionId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    for (const run of body.data) {
      expect(run.sessionId).toBe(sessionId);
    }
  });

  test("filters by status=completed", async () => {
    const response = await request("/api/evals/runs?status=completed", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    for (const run of body.data) {
      expect(run.status).toBe("completed");
    }
  });

  test("viewer role can list (200)", async () => {
    const response = await request("/api/evals/runs", {
      headers: viewerHeaders,
    });

    expect(response.status).toBe(200);
  });

  test("orgB cannot see orgA runs — RLS isolation", async () => {
    const response = await request("/api/evals/runs?page=1&pageSize=100", {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const orgARunIds = new Set(createdEvalRunIds);
    for (const run of body.data) {
      expect(orgARunIds.has(run.id)).toBe(false);
    }
  });
});

// ============================================================================
// GET /api/evals/runs/:runId — Get by ID
// ============================================================================

describe("GET /api/evals/runs/:runId", () => {
  test("returns run with detail (200)", async () => {
    const runId = createdEvalRunIds[0];
    const response = await request(`/api/evals/runs/${runId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(runId);
    expect(body.sourceType).toBe("suite");
    expect(body.status).toBe("completed");
    expect(body.createdAt).toBeDefined();
    expect(body.completedAt).toBeDefined();
  });

  test("returns 404 for non-existent run", async () => {
    const response = await request(
      "/api/evals/runs/00000000-0000-0000-0000-000000000099",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(404);
  });

  test("orgB cannot see orgA run — RLS isolation (404)", async () => {
    const runId = createdEvalRunIds[0];
    const response = await request(`/api/evals/runs/${runId}`, {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});
