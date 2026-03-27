/**
 * E2E integration test for synthetic test case generation (issue 179).
 *
 * Exercises the FULL flow through HTTP endpoints with REAL LLM calls:
 *   POST /api/eval-suites/:suiteId/generate-test-cases  →  202
 *   GET  /api/eval-suites/generation-tasks/:taskId       →  poll until done
 *   GET  /api/eval-suites/:suiteId                       →  verify test cases
 *
 * Requires ANTHROPIC_API_KEY to be set. All env vars are expected to be
 * configured in the test environment.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp, forOrg } from "@db/rls";
import {
  agentSops,
  agents,
  connectorTools,
  connectors,
  connectorsCatalog,
  evalSuiteTestCases,
  evalSuites,
  organizations,
  users,
} from "@db/schema";
import { eq } from "drizzle-orm";

import type { SeedUser } from "../helpers/seed";
import { authHeadersFor } from "../helpers/seed";

// Import app (no mocks — real LLM calls)
const app = (await import("@/app")).default;

// ============================================================================
// Test fixtures
// ============================================================================

let adminHeaders: Record<string, string>;
let orgId: string;
let agentId: string;
let sopId: string;
let suiteWithSopId: string;
let suiteWithoutSopId: string;

function request(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

/**
 * Poll generation task status until completed or failed.
 * Returns the final response body.
 */
async function pollUntilDone(
  taskId: string,
  { maxWaitMs = 120_000, intervalMs = 2_000 } = {},
) {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const res = await request(`/api/eval-suites/generation-tasks/${taskId}`, {
      headers: adminHeaders,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    if (
      body.progress?.status === "completed" ||
      body.progress?.status === "failed" ||
      body.status === "completed" ||
      body.status === "failed"
    ) {
      return body;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Generation task ${taskId} did not complete within ${maxWaitMs}ms`,
  );
}

beforeAll(async () => {
  let lookUpToolId: string;

  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: "E2E TCG Integration Org",
        slug: `e2e-tcg-${Date.now()}`,
      })
      .returning();
    orgId = org.id;

    const [adminUser] = await tx
      .insert(users)
      .values({
        organizationId: orgId,
        email: `e2e-tcg-admin-${Date.now()}@test.dev`,
        name: "E2E TCG Admin",
        role: "admin",
        isActive: true,
      })
      .returning();

    const seedUser: SeedUser = {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: adminUser.role as "admin",
      organizationId: adminUser.organizationId,
      isActive: adminUser.isActive,
    };
    adminHeaders = await authHeadersFor(seedUser);

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: orgId,
        name: "E2E TCG Agent",
        slug: `e2e-tcg-agent-${Date.now()}`,
        modality: "text",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });
    agentId = agent.id;

    // Need a connector tool so the SOP has tool-referencing steps
    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));

    const [storeConn] = await tx
      .insert(connectors)
      .values({
        organizationId: orgId,
        connectorCatalogId: medusa.id,
        name: "E2E Store",
        slug: `e2e_store_${Date.now()}`,
      })
      .returning({ id: connectors.id });

    const [lookUpTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: orgId,
        connectorId: storeConn.id,
        name: "Look Up Order",
        slug: "look_up_order",
      })
      .returning({ id: connectorTools.id });

    lookUpToolId = lookUpTool.id;
  });

  // Create SOP with tool-referencing steps
  const { createSop } = await import("@features/sops/sops.service");
  const sop = await createSop(orgId, {
    name: "E2E WISMO SOP",
    slug: `e2e-wismo-sop-${Date.now()}`,
    definition: {
      schemaVersion: 1,
      trigger: { type: "manual", config: {} as Record<string, never> },
      steps: [
        {
          id: "greet",
          order: 1,
          instruction: "Greet the customer warmly.",
          required: true,
        },
        {
          id: "lookup-order",
          order: 2,
          instruction:
            "Extract the order number and look up the order status using the order lookup tool.",
          required: true,
          tool: { connectorToolId: lookUpToolId! },
        },
        {
          id: "respond",
          order: 3,
          instruction:
            "Share the order status with the customer and offer further assistance.",
          required: true,
        },
      ],
      metadata: {},
    },
  });
  sopId = sop.id;

  await forApp(async (tx) => {
    await tx.insert(agentSops).values({ agentId, sopId });
  });

  // Create suites
  await forOrg(orgId, async (tx) => {
    const [suiteWithSop] = await tx
      .insert(evalSuites)
      .values({
        organizationId: orgId,
        agentId,
        sopId,
        name: "E2E Suite With SOP",
      })
      .returning();
    suiteWithSopId = suiteWithSop.id;

    const [suiteWithoutSop] = await tx
      .insert(evalSuites)
      .values({
        organizationId: orgId,
        agentId,
        sopId: null,
        name: "E2E Suite Without SOP",
      })
      .returning();
    suiteWithoutSopId = suiteWithoutSop.id;
  });
});

afterAll(async () => {
  if (orgId) {
    await forApp((tx) =>
      tx.delete(organizations).where(eq(organizations.id, orgId)),
    );
  }
});

// ============================================================================
// Tests
// ============================================================================

describe("E2E: Synthetic test case generation", () => {
  test("returns 400 when suite has no linked SOP", async () => {
    const res = await request(
      `/api/eval-suites/${suiteWithoutSopId}/generate-test-cases`,
      {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ count: 3 }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("no linked SOP");
  });

  test(
    "full flow: generate → poll → verify test cases in DB",
    async () => {
      const COUNT = 3; // Small count to keep LLM costs low

      // ── Step 1: POST to trigger generation ──
      const genRes = await request(
        `/api/eval-suites/${suiteWithSopId}/generate-test-cases`,
        {
          method: "POST",
          headers: { ...adminHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ count: COUNT }),
        },
      );

      expect(genRes.status).toBe(202);
      const { taskId, status: initialStatus } = await genRes.json();
      expect(taskId).toBeString();
      expect(initialStatus).toBe("running");

      // ── Step 2: Poll until done ──
      const finalStatus = await pollUntilDone(taskId);
      const progress = finalStatus.progress ?? finalStatus;

      expect(progress.status).toBe("completed");
      expect(progress.total).toBeGreaterThan(0);
      expect(progress.accepted).toBeGreaterThan(0);
      expect(progress.accepted + progress.rejected).toBe(progress.total);

      // ── Step 3: Verify GenerationRunResult ──
      const result = progress.result;
      expect(result).toBeDefined();

      // Accepted/rejected counts
      expect(result.accepted).toBe(progress.accepted);
      expect(result.rejected).toBe(progress.rejected);

      // Rejections structure
      expect(result.rejectionsBySource).toBeDefined();
      expect(result.rejectionsBySource).toHaveProperty("structural");
      expect(result.rejectionsBySource).toHaveProperty("semantic");
      expect(
        result.rejectionsBySource.structural +
          result.rejectionsBySource.semantic,
      ).toBe(result.rejected);

      // Top issues (array, capped at 5)
      expect(Array.isArray(result.topIssues)).toBe(true);
      expect(result.topIssues.length).toBeLessThanOrEqual(5);

      // Cost tracking
      expect(result.cost).toBeDefined();
      expect(result.cost.dimensionTokens.input).toBeGreaterThan(0);
      expect(result.cost.dimensionTokens.output).toBeGreaterThan(0);
      expect(result.cost.generationTokens.input).toBeGreaterThan(0);
      expect(result.cost.generationTokens.output).toBeGreaterThan(0);
      // Validation tokens may be 0 if all cases passed structural validation
      // and semantic validation was skipped — but should be tracked
      expect(result.cost.validationTokens).toBeDefined();
      expect(result.cost.estimatedCostUsd).toBeGreaterThan(0);

      // ── Step 4: Verify test cases in database ──
      const insertedCases = await forOrg(orgId, async (tx) =>
        tx
          .select()
          .from(evalSuiteTestCases)
          .where(eq(evalSuiteTestCases.suiteId, suiteWithSopId)),
      );

      expect(insertedCases.length).toBe(result.accepted);

      for (const tc of insertedCases) {
        // Source must be "auto"
        expect(tc.source).toBe("auto");

        // Input must have { message, persona } shape
        const input = tc.input as {
          message?: string;
          persona?: string;
        } | null;
        expect(input).toBeDefined();
        expect(input).not.toBeNull();
        expect(input!.message).toBeString();
        expect(input!.message!.split(/\s+/).length).toBeGreaterThanOrEqual(5);
        expect(input!.persona).toBeString();

        // Persona must be one of the valid mapped IDs
        const validPersonas = new Set([
          "polite-buyer",
          "impatient-returner",
          "confused-browser",
        ]);
        expect(validPersonas.has(input!.persona!)).toBe(true);

        // mockToolResponses must be populated (SOP has tool step)
        const mockResponses = tc.mockToolResponses as Record<
          string,
          unknown
        > | null;
        expect(mockResponses).toBeDefined();
        expect(mockResponses).not.toBeNull();
        expect(Object.keys(mockResponses!).length).toBeGreaterThan(0);

        // Name and description must be set
        expect(tc.name).toBeString();
        expect(tc.name.length).toBeGreaterThan(0);
        expect(tc.description).toBeString();
      }
    },
    // LLM calls can be slow — generous timeout
    { timeout: 180_000 },
  );

  test(
    "re-generation deletes old auto cases and replaces them",
    async () => {
      // Verify cases from previous test exist
      const beforeCases = await forOrg(orgId, async (tx) =>
        tx
          .select()
          .from(evalSuiteTestCases)
          .where(eq(evalSuiteTestCases.suiteId, suiteWithSopId)),
      );
      const autoBefore = beforeCases.filter((c) => c.source === "auto");
      expect(autoBefore.length).toBeGreaterThan(0);
      const oldAutoIds = autoBefore.map((c) => c.id);

      // Add a manual case that should survive re-generation
      const { createTestCase } = await import(
        "@features/evals/eval-suites.service"
      );
      const manualCase = await createTestCase(orgId, suiteWithSopId, {
        name: "Manual case — must survive",
        source: "manual",
      });

      // Trigger re-generation
      const genRes = await request(
        `/api/eval-suites/${suiteWithSopId}/generate-test-cases`,
        {
          method: "POST",
          headers: { ...adminHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ count: 2 }),
        },
      );
      expect(genRes.status).toBe(202);
      const { taskId } = await genRes.json();

      // Poll until done
      const finalStatus = await pollUntilDone(taskId);
      const progress = finalStatus.progress ?? finalStatus;
      expect(progress.status).toBe("completed");

      // Verify old auto cases are gone, manual case survives
      const afterCases = await forOrg(orgId, async (tx) =>
        tx
          .select()
          .from(evalSuiteTestCases)
          .where(eq(evalSuiteTestCases.suiteId, suiteWithSopId)),
      );

      const remainingIds = afterCases.map((c) => c.id);
      for (const oldId of oldAutoIds) {
        expect(remainingIds).not.toContain(oldId);
      }

      // Manual case must still exist
      expect(remainingIds).toContain(manualCase.id);

      // New auto cases were inserted
      const newAutoCases = afterCases.filter((c) => c.source === "auto");
      expect(newAutoCases.length).toBeGreaterThan(0);
    },
    { timeout: 180_000 },
  );
});
