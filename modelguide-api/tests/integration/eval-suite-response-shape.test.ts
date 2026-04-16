/**
 * Integration test: GET /api/eval-suites/:id response shape.
 *
 * Verifies that suite evaluators and test-case evaluator overrides
 * include `evaluatorType` and `config` fields (AC-28 prerequisite).
 *
 * This was the root-cause investigation for issue #214 — the UI type
 * badges and edit dialog depend on these fields being present.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forOrg } from "@db/rls";
import { evalConfigs, evalSuites } from "@db/schema";
import { inArray } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let adminHeaders: Record<string, string>;

/** IDs to clean up */
const createdSuiteIds: string[] = [];
const createdConfigIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  adminHeaders = await authHeadersFor(s.orgAAdmin);
});

afterAll(async () => {
  const orgId = s.orgA.id;
  await forOrg(orgId, async (tx) => {
    if (createdSuiteIds.length > 0) {
      await tx
        .delete(evalSuites)
        .where(inArray(evalSuites.id, createdSuiteIds));
    }
    if (createdConfigIds.length > 0) {
      await tx
        .delete(evalConfigs)
        .where(inArray(evalConfigs.id, createdConfigIds));
    }
  });
});

// ============================================================================
// GET /api/eval-suites/:id — response shape
// ============================================================================

describe("GET /api/eval-suites/:id — evaluatorType + config in response", () => {
  let suiteId: string;
  let evalConfigId: string;
  let evaluatorId: string;
  let testCaseId: string;

  beforeAll(async () => {
    // 1. Create eval config
    const configRes = await request("/api/eval-configs", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "response-shape-test: llm_judge",
        evaluatorType: "llm_judge",
        config: { criterion: "Agent was helpful" },
      }),
    });
    expect(configRes.status).toBe(201);
    const configBody = await configRes.json();
    evalConfigId = configBody.id;
    createdConfigIds.push(evalConfigId);

    // 2. Create eval suite
    const suiteRes = await request("/api/eval-suites", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        agentId: s.orgAAgentId,
        name: "response-shape-test suite",
      }),
    });
    expect(suiteRes.status).toBe(201);
    const suiteBody = await suiteRes.json();
    suiteId = suiteBody.id;
    createdSuiteIds.push(suiteId);

    // 3. Add evaluator to suite
    const evalRes = await request(`/api/eval-suites/${suiteId}/evaluators`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        evalConfigId,
        name: "response-shape-test evaluator",
      }),
    });
    expect(evalRes.status).toBe(201);
    const evalBody = await evalRes.json();
    evaluatorId = evalBody.id;

    // 4. Create a test case
    const tcRes = await request(`/api/eval-suites/${suiteId}/test-cases`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "response-shape-test case" }),
    });
    expect(tcRes.status).toBe(201);
    const tcBody = await tcRes.json();
    testCaseId = tcBody.id;

    // 5. Create a second eval config for the add override
    const addConfigRes = await request("/api/eval-configs", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "response-shape-test: tool_called",
        evaluatorType: "tool_called",
        config: { connectorToolId: "00000000-0000-0000-0000-000000000001" },
      }),
    });
    expect(addConfigRes.status).toBe(201);
    const addConfigBody = await addConfigRes.json();
    createdConfigIds.push(addConfigBody.id);

    // 6. Add test-case override (add)
    const overrideRes = await request(
      `/api/eval-suites/${suiteId}/test-cases/${testCaseId}/evaluators`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          evalConfigId: addConfigBody.id,
          overrideType: "add",
          name: "response-shape-test override",
        }),
      },
    );
    expect(overrideRes.status).toBe(201);
  });

  test("suite evaluators include evaluatorType and config", async () => {
    const res = await request(`/api/eval-suites/${suiteId}`, {
      headers: adminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const evaluators = body.evaluators ?? [];
    expect(evaluators.length).toBeGreaterThan(0);

    const ev = evaluators.find((e: { id: string }) => e.id === evaluatorId);
    expect(ev).toBeDefined();
    expect(ev.evaluatorType).toBe("llm_judge");
    expect(ev.config).toEqual({ criterion: "Agent was helpful" });
  });

  test("test case evaluator overrides (add) include evaluatorType and config", async () => {
    const res = await request(`/api/eval-suites/${suiteId}`, {
      headers: adminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const tc = (body.testCases ?? []).find(
      (t: { id: string }) => t.id === testCaseId,
    );
    expect(tc).toBeDefined();

    const overrides = tc.evaluatorOverrides ?? [];
    expect(overrides.length).toBe(1);

    const override = overrides[0];
    expect(override.overrideType).toBe("add");
    expect(override.evaluatorType).toBe("tool_called");
    expect(override.config).toMatchObject({
      connectorToolId: "00000000-0000-0000-0000-000000000001",
    });
  });

  test("PATCH /eval-suites/:id/evaluators/:evaluatorId returns 200 (AC-26)", async () => {
    // Create a second config to patch to
    const configRes = await request("/api/eval-configs", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "response-shape-test: patch target",
        evaluatorType: "llm_judge",
        config: { criterion: "Agent was concise" },
      }),
    });
    expect(configRes.status).toBe(201);
    const newConfig = await configRes.json();
    createdConfigIds.push(newConfig.id);

    const patchRes = await request(
      `/api/eval-suites/${suiteId}/evaluators/${evaluatorId}`,
      {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ evalConfigId: newConfig.id }),
      },
    );
    expect(patchRes.status).toBe(200);

    // Verify the suite now reflects the updated config
    const suiteRes = await request(`/api/eval-suites/${suiteId}`, {
      headers: adminHeaders,
    });
    const suiteBody = await suiteRes.json();
    const ev = (suiteBody.evaluators ?? []).find(
      (e: { id: string }) => e.id === evaluatorId,
    );
    expect(ev.config).toEqual({ criterion: "Agent was concise" });
  });
});
