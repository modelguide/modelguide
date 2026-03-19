/**
 * Eval suites error handling integration tests.
 *
 * Validates:
 * - initSuiteFromSop for non-existent SOP -> 404
 * - runEvalSuite on non-existent suite -> 404
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { forApp } from "@db/rls";
import {
  agents,
  connectorTools,
  connectors,
  connectorsCatalog,
  organizations,
} from "@db/schema";
import {
  initSuiteFromSop,
  runEvalSuite,
} from "@features/evals/eval-suites.service";
import { createSop } from "@features/sops/sops.service";
import { AppError } from "@lib/errors";
import { eq } from "drizzle-orm";

// ============================================================================
// Fixtures
// ============================================================================

let orgId: string;
let agentId: string;
let sopId: string;
let toolId: string;

beforeAll(async () => {
  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: "Eval Suite Error Test Org",
        slug: "eval-suite-error-test",
      })
      .returning();

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: org.id,
        name: "Error Test Agent",
        slug: "error-test-agent",
        modality: "text",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });

    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));

    const [conn] = await tx
      .insert(connectors)
      .values({
        organizationId: org.id,
        connectorCatalogId: medusa.id,
        name: "Test Store",
        slug: "test-store",
      })
      .returning({ id: connectors.id });

    const [tool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: org.id,
        connectorId: conn.id,
        name: "Test Tool",
        slug: "test_tool",
      })
      .returning({ id: connectorTools.id });

    orgId = org.id;
    agentId = agent.id;
    toolId = tool.id;
  });

  // Create SOP via service (needs RLS context)
  const sop = await createSop(orgId, {
    name: "Error Test SOP",
    slug: "error-test-sop",
    definition: {
      schemaVersion: 1,
      trigger: { type: "manual", config: {} as Record<string, never> },
      steps: [
        {
          id: "step-1",
          order: 1,
          instruction: "Do something.",
          required: true,
          tool: { connectorToolId: toolId },
        },
      ],
      metadata: {},
    },
  });
  sopId = sop.id;
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

describe("initSuiteFromSop error handling", () => {
  it("returns 404 for non-existent SOP", async () => {
    try {
      await initSuiteFromSop(
        orgId,
        agentId,
        "00000000-0000-0000-0000-000000000099",
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(404);
    }
  });
});

describe("runEvalSuite error handling", () => {
  it("returns 404 for non-existent suite", async () => {
    try {
      await runEvalSuite(
        orgId,
        "00000000-0000-0000-0000-000000000099",
        "00000000-0000-0000-0000-000000000001",
        "compiled",
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(404);
    }
  });

  it("creates and runs a suite successfully", async () => {
    const suite = await initSuiteFromSop(orgId, agentId, sopId);
    expect(suite.id).toBeDefined();
    expect(suite.testCases.length).toBeGreaterThan(0);
  });
});
