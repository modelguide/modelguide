/**
 * Integration tests for synthetic test case generation (issue 179).
 *
 * Route-level tests validate HTTP endpoints. The full pipeline test
 * mocks the dimension derivation, generation, and validation modules
 * and exercises the service layer directly against the real database.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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

// ============================================================================
// Mock setup — intercept LLM-calling modules before service import
// ============================================================================

const mockDimensionConfig = {
  intents: ["order_status", "delivery_delay", "refund_request"],
  tones: ["polite", "frustrated", "confused", "hostile", "terse"],
  complexity: ["single_step", "multi_step", "requires_escalation"],
  edgeCases: [
    "straightforward",
    "ambiguous_intent",
    "missing_order_number",
    "contradictory_request",
    "multiple_issues_single_email",
  ],
  toolStates: {
    wf_gen_store_look_up_order: [
      { orderId: "ORD-001", status: "shipped", trackingNumber: "TRK123" },
      { orderId: "ORD-002", status: "processing", trackingNumber: null },
      { error: true, message: "Order not found" },
    ],
  },
};

const mockGeneratedTestCase = {
  name: "order_status - polite - straightforward",
  scenario: "Customer wants to know the status of their recent order.",
  customer_message:
    "Hi there, I placed an order last week and was wondering about its current status. My order number is ORD-001. Thanks!",
  mock_tool_responses: {
    wf_gen_store_look_up_order: {
      orderId: "ORD-001",
      status: "shipped",
      trackingNumber: "TRK123",
    },
  },
};

let generateCallCount = 0;

/**
 * Mock the three pipeline stage modules that call generateObject from `ai`.
 * We mock at the feature module level (not the `ai` package itself) to
 * avoid bun's mock.module side effects on unrelated modules.
 */

// toneToPersonaId mapping (copied from dimensions.ts — pure function, no LLM)
const TONE_PERSONA_MAP: Record<string, string> = {
  frustrated: "impatient-returner",
  hostile: "impatient-returner",
  confused: "confused-browser",
  polite: "polite-buyer",
  terse: "terse-buyer",
};

function toneToPersonaId(tone: string): string {
  return TONE_PERSONA_MAP[tone] ?? "polite-buyer";
}

// selectTuples — import the real implementation since it has no LLM calls
// We inline a minimal version matching the real signature for the mock
import type {
  DimensionConfig,
  DimensionTuple,
} from "@features/test-case-generation/types";

function selectTuplesMock(
  dims: DimensionConfig,
  opts: { count: number },
): DimensionTuple[] {
  // Generate a deterministic set of tuples for testing
  const tuples: DimensionTuple[] = [];
  const toolSlugs = Object.keys(dims.toolStates);

  for (const intent of dims.intents) {
    if (tuples.length >= opts.count) break;

    const toolState: Record<
      string,
      Record<string, string | number | boolean | null>
    > = {};
    for (const slug of toolSlugs) {
      toolState[slug] = dims.toolStates[slug][0];
    }

    tuples.push({
      intent,
      tone: "polite",
      complexity: "single_step",
      edgeCase: "straightforward",
      toolState,
    });
  }

  return tuples;
}

mock.module("@features/test-case-generation/dimensions", () => ({
  deriveDimensionsFromSop: mock(async () => ({
    dimensions: mockDimensionConfig,
    usage: { input: 500, output: 200 },
  })),
  selectTuples: selectTuplesMock,
  toneToPersonaId,
}));

mock.module("@features/test-case-generation/generate", () => ({
  generateTestCase: mock(async () => {
    generateCallCount++;
    return {
      testCase: {
        ...mockGeneratedTestCase,
        name: `${mockGeneratedTestCase.name} #${generateCallCount}`,
      },
      usage: { input: 300, output: 150 },
    };
  }),
}));

mock.module("@features/test-case-generation/validate", () => ({
  validateStructural: mock(() => ({
    valid: true,
    issues: [],
    source: null,
  })),
  validateSemantic: mock(async () => ({
    result: { valid: true, issues: [], source: null },
    usage: { input: 200, output: 50 },
  })),
}));

// Dynamic import AFTER mock.module so the mocks are in effect
const { enqueueGenerateTestCases } = await import(
  "@features/test-case-generation/service"
);
const { createTestCase } = await import("@features/evals/eval-suites.service");
const { createSop } = await import("@features/sops/sops.service");
const app = (await import("@/app")).default;

// ============================================================================
// Test fixtures
// ============================================================================

let adminHeaders: Record<string, string>;

/** Isolated org for this test file — cleaned up via cascade in afterAll. */
let orgId: string;
let agentId: string;
let sopId: string;
let suiteWithSopId: string;
let suiteWithoutSopId: string;

function request(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

beforeAll(async () => {
  // Create isolated org + admin user + agent + connector + tool
  let lookUpToolId: string;

  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: "Test Case Gen Integration Org",
        slug: `tcg-integ-${Date.now()}`,
      })
      .returning();
    orgId = org.id;

    // Create admin user in this org for auth headers
    const [adminUser] = await tx
      .insert(users)
      .values({
        organizationId: orgId,
        email: "tcg-admin@test.dev",
        name: "TCG Admin",
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
        name: "TCG Test Agent",
        slug: "tcg-test-agent",
        modality: "text",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });
    agentId = agent.id;

    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));

    const [storeConn] = await tx
      .insert(connectors)
      .values({
        organizationId: orgId,
        connectorCatalogId: medusa.id,
        name: "TCG Store",
        slug: "wf_gen_store",
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

  // Create SOP outside forApp so createSop's internal forOrg works correctly
  const sop = await createSop(orgId, {
    name: "TCG Test WISMO SOP",
    slug: "tcg-test-wismo-sop",
    definition: {
      schemaVersion: 1,
      trigger: { type: "manual", config: {} as Record<string, never> },
      steps: [
        {
          id: "classify-intent",
          order: 1,
          instruction: "Classify the email intent.",
          required: true,
        },
        {
          id: "lookup-order",
          order: 2,
          instruction: "Look up order using extracted order number.",
          required: true,
          tool: { connectorToolId: lookUpToolId! },
        },
        {
          id: "compose-reply",
          order: 3,
          instruction: "Compose reply based on order lookup result.",
          required: true,
        },
      ],
      metadata: {},
    },
  });
  sopId = sop.id;

  // Assign SOP to agent (agent_sops has no RLS — forApp is fine)
  await forApp(async (tx) => {
    await tx.insert(agentSops).values({ agentId, sopId });
  });

  // Create suites via forOrg (eval_suites has RLS but no bypass_rls_policy)
  await forOrg(orgId, async (tx) => {
    const [suiteWithSop] = await tx
      .insert(evalSuites)
      .values({
        organizationId: orgId,
        agentId,
        sopId,
        name: "TCG Suite With SOP",
      })
      .returning();
    suiteWithSopId = suiteWithSop.id;

    const [suiteWithoutSop] = await tx
      .insert(evalSuites)
      .values({
        organizationId: orgId,
        agentId,
        sopId: null,
        name: "TCG Suite Without SOP",
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
// Route-level tests
// ============================================================================

describe("POST /api/eval-suites/:suiteId/generate-test-cases", () => {
  test("returns 202 with taskId and status 'running'", async () => {
    const response = await request(
      `/api/eval-suites/${suiteWithSopId}/generate-test-cases`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ count: 5 }),
      },
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toHaveProperty("taskId");
    expect(body.taskId).toBeString();
    expect(body.status).toBe("running");
  });

  test("returns 400 when suite has no linked SOP", async () => {
    const response = await request(
      `/api/eval-suites/${suiteWithoutSopId}/generate-test-cases`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ count: 5 }),
      },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("Suite has no linked SOP");
  });

  test("re-generation deletes old auto cases", async () => {
    // First, create some auto-sourced test cases manually
    const tc1 = await createTestCase(orgId, suiteWithSopId, {
      name: "Old auto case 1",
      source: "auto",
    });
    const tc2 = await createTestCase(orgId, suiteWithSopId, {
      name: "Old auto case 2",
      source: "auto",
    });

    // Also create a manual case that should NOT be deleted
    const manualTc = await createTestCase(orgId, suiteWithSopId, {
      name: "Manual case - should survive",
      source: "manual",
    });

    // Verify they exist
    const beforeCases = await forOrg(orgId, async (tx) =>
      tx
        .select()
        .from(evalSuiteTestCases)
        .where(eq(evalSuiteTestCases.suiteId, suiteWithSopId)),
    );
    const autoBefore = beforeCases.filter((c) => c.source === "auto");
    expect(autoBefore.length).toBeGreaterThanOrEqual(2);

    // Call generate — deletion of old auto cases is deferred into the async handler
    const response = await request(
      `/api/eval-suites/${suiteWithSopId}/generate-test-cases`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ count: 3 }),
      },
    );
    expect(response.status).toBe(202);
    const body = await response.json();

    // Wait for async task to complete (deletion happens inside the handler)
    const { taskRunner } = await import("@lib/task-runner");
    const maxWaitMs = 10_000;
    const start = Date.now();
    let state = taskRunner.getStatus(body.taskId);
    while (
      state &&
      state.status !== "completed" &&
      state.status !== "failed" &&
      Date.now() - start < maxWaitMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      state = taskRunner.getStatus(body.taskId);
    }

    // Old auto cases should be gone (replaced by new ones)
    const afterCases = await forOrg(orgId, async (tx) =>
      tx
        .select()
        .from(evalSuiteTestCases)
        .where(eq(evalSuiteTestCases.suiteId, suiteWithSopId)),
    );

    const oldAutoIds = [tc1.id, tc2.id];
    const remainingAutoIds = afterCases
      .filter((c) => c.source === "auto")
      .map((c) => c.id);
    for (const oldId of oldAutoIds) {
      expect(remainingAutoIds).not.toContain(oldId);
    }

    // Manual case should still exist
    const manualAfter = afterCases.filter((c) => c.source === "manual");
    const manualIds = manualAfter.map((c) => c.id);
    expect(manualIds).toContain(manualTc.id);
  });
});

// ============================================================================
// Full pipeline integration test (service level)
// ============================================================================

describe("Full generation pipeline", () => {
  test("generates test cases with correct shape, source, and cost tracking", async () => {
    // Reset mock call counter
    generateCallCount = 0;

    // Create a fresh suite for this test (forOrg since eval_suites has RLS)
    const [freshSuite] = await forOrg(orgId, async (tx) =>
      tx
        .insert(evalSuites)
        .values({
          organizationId: orgId,
          agentId,
          sopId,
          name: "Pipeline Test Suite",
        })
        .returning(),
    );

    // Call the service directly — this is the showcase test
    const { taskId } = await enqueueGenerateTestCases(orgId, freshSuite.id, 5);

    expect(taskId).toBeString();

    // Wait for the async task to complete
    const { taskRunner } = await import("@lib/task-runner");
    let state = taskRunner.getStatus(taskId);
    const maxWaitMs = 10_000;
    const start = Date.now();
    while (
      state &&
      state.status !== "completed" &&
      state.status !== "failed" &&
      Date.now() - start < maxWaitMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      state = taskRunner.getStatus(taskId);
    }

    expect(state).toBeDefined();
    expect(state!.status).toBe("completed");

    // Verify progress has result
    const progress = state!.progress as {
      status: string;
      completed: number;
      total: number;
      accepted: number;
      rejected: number;
      result?: {
        accepted: number;
        rejected: number;
        rejections: Array<{
          tupleName: string;
          issues: string[];
          rejectionSource: string;
        }>;
        rejectionsBySource: {
          structural: number;
          semantic: number;
          error: number;
        };
        topIssues: Array<{ issue: string; count: number }>;
        cost: {
          dimensionTokens: { input: number; output: number };
          generationTokens: { input: number; output: number };
          validationTokens: { input: number; output: number };
          estimatedCostUsd: number;
        };
      };
    };

    expect(progress).toBeDefined();
    expect(progress.status).toBe("completed");
    expect(progress.result).toBeDefined();

    const result = progress.result!;

    // All mock cases pass validation, so accepted should equal total
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.accepted + result.rejected).toBe(progress.total);

    // Cost tracking from dimension derivation mock
    expect(result.cost.dimensionTokens.input).toBe(500);
    expect(result.cost.dimensionTokens.output).toBe(200);

    // Cost tracking from generation (300 input per call, 150 output per call)
    expect(result.cost.generationTokens.input).toBeGreaterThan(0);
    expect(result.cost.generationTokens.output).toBeGreaterThan(0);

    // Cost tracking from validation (200 input per call, 50 output per call)
    expect(result.cost.validationTokens.input).toBeGreaterThan(0);
    expect(result.cost.validationTokens.output).toBeGreaterThan(0);

    // Estimated cost should be positive
    expect(result.cost.estimatedCostUsd).toBeGreaterThan(0);

    // Rejection tracking structure
    expect(result.rejectionsBySource).toHaveProperty("structural");
    expect(result.rejectionsBySource).toHaveProperty("semantic");

    // Verify test cases in the database
    const insertedCases = await forOrg(orgId, async (tx) =>
      tx
        .select()
        .from(evalSuiteTestCases)
        .where(eq(evalSuiteTestCases.suiteId, freshSuite.id)),
    );

    expect(insertedCases.length).toBe(result.accepted);

    for (const tc of insertedCases) {
      // Source should be "auto"
      expect(tc.source).toBe("auto");

      // Input should have { message, persona } shape
      const input = tc.input as { message?: string; persona?: string } | null;
      expect(input).toBeDefined();
      expect(input).not.toBeNull();
      expect(input!.message).toBeString();
      expect(input!.message!.length).toBeGreaterThan(0);
      expect(input!.persona).toBeString();

      // persona should be a valid persona ID
      const validPersonas = new Set([
        "polite-buyer",
        "impatient-returner",
        "confused-browser",
        "terse-buyer",
      ]);
      expect(validPersonas.has(input!.persona!)).toBe(true);

      // mockToolResponses should be populated (our SOP has a tool step)
      const mockResponses = tc.mockToolResponses as Record<
        string,
        unknown
      > | null;
      expect(mockResponses).toBeDefined();
      expect(mockResponses).not.toBeNull();

      // Name should be set
      expect(tc.name).toBeString();
      expect(tc.name.length).toBeGreaterThan(0);

      // Description (scenario) should be set
      expect(tc.description).toBeString();
    }

    // generateTestCase should have been called at least once per accepted case
    expect(generateCallCount).toBeGreaterThanOrEqual(result.accepted);

    // Cleanup
    await forOrg(orgId, (tx) =>
      tx.delete(evalSuites).where(eq(evalSuites.id, freshSuite.id)),
    );
  });
});
