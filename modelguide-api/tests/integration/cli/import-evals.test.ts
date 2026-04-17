/**
 * Integration tests for mg import-evals command.
 *
 * Tests suite-level evaluator reconciliation behaviour introduced in PR #233:
 * - commonEvaluatorNames are attached as source="auto" rows in eval_suite_evaluators
 * - Re-import reconciles: stale auto rows are deleted, missing ones inserted
 * - Manual rows (source="manual") are never touched
 * - onConflictDoNothing prevents duplicates on idempotent re-import
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp, forOrg } from "@db/rls";
import {
  agents,
  apiKeys,
  evalConfigs,
  evalSuiteEvaluators,
  evalSuiteTestCases,
  evalSuites,
  evalTestCaseEvaluators,
  organizations,
  sopSteps,
  sops,
  users,
} from "@db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { handleAddAgents } from "../../../src/cli/commands/add-agents";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { handleImportEvals } from "../../../src/cli/commands/import-evals";
import { handleImportSops } from "../../../src/cli/commands/import-sops";
import { IdRegistry } from "../../../src/cli/lib/id-registry";
import type { NormalizedEvalsInput } from "../../../src/cli/schemas/evals.schema";

// ============================================================================
// Constants
// ============================================================================

const TEST_SLUG = `cli-evals-test-${Date.now()}`;
const AGENT_SLUG = "evals-test-agent";
const SOP_SLUG_RECONCILE = "evals-test-sop-reconcile";
const SOP_SLUG_EMPTY = "evals-test-sop-empty";

// ============================================================================
// Shared state
// ============================================================================

let orgId: string;
let registry: IdRegistry;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a NormalizedEvalsInput with 2 evaluators (e-suite and e-case),
 * one test case referencing both evaluators for the given SOP slug,
 * and the given names promoted to suite level via commonEvaluatorNames.
 */
function makeInput(
  sopSlug: string,
  commonEvaluatorNames: string[],
): NormalizedEvalsInput {
  return {
    agentSlug: AGENT_SLUG,
    evaluators: [
      {
        name: "e-suite",
        criterion: "The agent stays polite at all times.",
        tags: [],
      },
      {
        name: "e-case",
        criterion: "The agent correctly resolves the customer's issue.",
        tags: [],
      },
    ],
    commonEvaluatorNames,
    testCases: [
      {
        id: `tc-${sopSlug}-001`,
        sopSlug,
        tags: [],
        guardrailsTested: [],
        evaluatorNames: ["e-suite", "e-case"],
        input: {
          message: "Hello, I need help with my order.",
        },
      },
    ],
  };
}

/** Read evalSuiteEvaluators rows for a suite via forOrg. */
async function getSuiteEvaluators(suiteId: string) {
  return forOrg(orgId, (tx) =>
    tx
      .select()
      .from(evalSuiteEvaluators)
      .where(eq(evalSuiteEvaluators.suiteId, suiteId)),
  );
}

/** Find the eval suite for (agentId, sopId) via the registry. */
async function getEvalSuiteId(sopSlug: string): Promise<string> {
  const sopId = registry.get("sop", sopSlug);
  const agentId = registry.get("agent", AGENT_SLUG);

  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(and(eq(evalSuites.agentId, agentId), eq(evalSuites.sopId, sopId))),
  );

  if (!rows[0]) {
    throw new Error(
      `No eval suite found for agent "${AGENT_SLUG}" + SOP "${sopSlug}"`,
    );
  }
  return rows[0].id;
}

// ============================================================================
// Setup / teardown
// ============================================================================

beforeAll(async () => {
  registry = new IdRegistry();

  const org = await handleCreateOrg({
    name: "CLI Evals Test",
    slug: TEST_SLUG,
    demoEnabled: false,
  });
  orgId = org.id;

  await handleAddUsers(orgId, [
    {
      email: "evals-admin@test.com",
      name: "Evals Admin",
      role: "admin",
    },
  ]);

  await handleAddAgents(
    orgId,
    [
      {
        name: "Evals Test Agent",
        slug: AGENT_SLUG,
        modality: "voice",
        platform: "custom",
        active: false,
        tools: [],
        secrets: [],
      },
    ],
    { registry },
  );

  // Create the two SOPs that test cases will reference
  await handleImportSops(
    orgId,
    [
      {
        name: "Evals Test SOP Reconcile",
        slug: SOP_SLUG_RECONCILE,
        agents: [AGENT_SLUG],
        steps: [
          {
            id: "step-1",
            instruction: "Greet the customer.",
            required: true,
          },
        ],
      },
      {
        name: "Evals Test SOP Empty",
        slug: SOP_SLUG_EMPTY,
        agents: [AGENT_SLUG],
        steps: [
          {
            id: "step-1",
            instruction: "Resolve the customer issue.",
            required: true,
          },
        ],
      },
    ],
    { registry },
  );
});

afterAll(async () => {
  // NOTE: eval suite tables (eval_suites, eval_suite_test_cases, etc.) have RLS
  // policies that require app.organization_id to be set — they lack bypass_rls_policy.
  // Use forOrg for those tables, forApp for the rest.

  // 1-6: Clean up eval suite data via forOrg (RLS requires org context)
  const orgSuites = await forOrg(orgId, (tx) =>
    tx
      .select({ id: evalSuites.id })
      .from(evalSuites)
      .where(eq(evalSuites.organizationId, orgId)),
  );

  const suiteIds = orgSuites.map((s) => s.id);

  if (suiteIds.length > 0) {
    const orgTestCases = await forOrg(orgId, (tx) =>
      tx
        .select({ id: evalSuiteTestCases.id })
        .from(evalSuiteTestCases)
        .where(inArray(evalSuiteTestCases.suiteId, suiteIds)),
    );

    const testCaseIds = orgTestCases.map((tc) => tc.id);

    if (testCaseIds.length > 0) {
      await forOrg(orgId, (tx) =>
        tx
          .delete(evalTestCaseEvaluators)
          .where(inArray(evalTestCaseEvaluators.testCaseId, testCaseIds)),
      );
    }

    await forOrg(orgId, (tx) =>
      tx
        .delete(evalSuiteTestCases)
        .where(inArray(evalSuiteTestCases.suiteId, suiteIds)),
    );

    await forOrg(orgId, (tx) =>
      tx
        .delete(evalSuiteEvaluators)
        .where(inArray(evalSuiteEvaluators.suiteId, suiteIds)),
    );

    await forOrg(orgId, (tx) =>
      tx.delete(evalSuites).where(eq(evalSuites.organizationId, orgId)),
    );
  }

  // 7-10: Clean up the rest via forApp (these tables have bypass_rls_policy)
  await forApp(async (tx) => {
    // 7. Delete evalConfigs (has bypass_rls_policy)
    await tx.delete(evalConfigs).where(eq(evalConfigs.organizationId, orgId));

    // 8. Clean up SOPs
    const orgSops = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.organizationId, orgId));

    for (const sop of orgSops) {
      await tx.delete(sopSteps).where(eq(sopSteps.sopId, sop.id));
    }
    await tx.delete(sops).where(eq(sops.organizationId, orgId));

    // 9. Delete agents and their API keys
    const orgAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.organizationId, orgId));

    for (const agent of orgAgents) {
      await tx.delete(apiKeys).where(eq(apiKeys.agentId, agent.id));
    }
    await tx.delete(agents).where(eq(agents.organizationId, orgId));

    // 10. Delete users and organization
    await tx.delete(users).where(eq(users.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

// ============================================================================
// Tests: suite-level evaluator reconciliation
// ============================================================================

// Tests 1–6 run sequentially — each builds on the DB state left by the previous test.
describe("import-evals — suite-level evaluator reconciliation", () => {
  test("Test 1: first import creates suite and attaches common evaluators as auto rows", async () => {
    const result = await handleImportEvals(
      orgId,
      makeInput(SOP_SLUG_RECONCILE, ["e-suite"]),
      { registry },
    );

    expect(result.suitesCreated).toBe(1);
    expect(result.evalConfigsCreated).toBe(2);

    const suiteId = await getEvalSuiteId(SOP_SLUG_RECONCILE);
    const rows = await getSuiteEvaluators(suiteId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("e-suite");
    expect(rows[0]!.source).toBe("auto");
    expect(rows[0]!.order).toBe(0);
  });

  test("Test 2: per-case override only contains names NOT at suite level", async () => {
    const suiteId = await getEvalSuiteId(SOP_SLUG_RECONCILE);

    const testCases = await forOrg(orgId, (tx) =>
      tx
        .select({ id: evalSuiteTestCases.id })
        .from(evalSuiteTestCases)
        .where(eq(evalSuiteTestCases.suiteId, suiteId)),
    );

    expect(testCases).toHaveLength(1);

    const overrides = await forOrg(orgId, (tx) =>
      tx
        .select()
        .from(evalTestCaseEvaluators)
        .where(eq(evalTestCaseEvaluators.testCaseId, testCases[0]!.id)),
    );

    // e-suite is at suite level so only e-case should be a per-case override
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.name).toBe("e-case");
  });

  test("Test 3: re-import with same names is idempotent — no duplicates", async () => {
    // Re-import with identical input (suite already exists)
    const reimportResult = await handleImportEvals(
      orgId,
      makeInput(SOP_SLUG_RECONCILE, ["e-suite"]),
      { registry },
    );
    expect(reimportResult.suitesExisting).toBe(1);
    expect(reimportResult.suitesCreated).toBe(0);

    const suiteId = await getEvalSuiteId(SOP_SLUG_RECONCILE);
    const rows = await getSuiteEvaluators(suiteId);

    // unique constraint + onConflictDoNothing prevents duplicate; still exactly 1
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("e-suite");
  });

  test("Test 4: adding a name to common_evaluators inserts a new auto row", async () => {
    await handleImportEvals(
      orgId,
      makeInput(SOP_SLUG_RECONCILE, ["e-suite", "e-case"]),
      { registry },
    );

    const suiteId = await getEvalSuiteId(SOP_SLUG_RECONCILE);
    const rows = await getSuiteEvaluators(suiteId);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["e-case", "e-suite"]);
  });

  test("Test 5: removing a name from common_evaluators deletes its auto row", async () => {
    await handleImportEvals(orgId, makeInput(SOP_SLUG_RECONCILE, ["e-suite"]), {
      registry,
    });

    const suiteId = await getEvalSuiteId(SOP_SLUG_RECONCILE);
    const rows = await getSuiteEvaluators(suiteId);

    // e-case auto row should be removed; only e-suite remains
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("e-suite");
  });

  test("Test 6: manual rows survive reconcile", async () => {
    const suiteId = await getEvalSuiteId(SOP_SLUG_RECONCILE);

    // Look up the e-case config ID from the registry (populated in Test 1)
    const eCaseConfigId = registry.get("evalConfig", "e-case");

    // Manually insert a row with source="manual" for e-case
    await forOrg(orgId, (tx) =>
      tx.insert(evalSuiteEvaluators).values({
        organizationId: orgId,
        suiteId,
        evalConfigId: eCaseConfigId,
        name: "e-case",
        order: 99,
        required: true,
        source: "manual",
      }),
    );

    // Re-import with only e-suite in common_evaluators (e-case not in common list)
    await handleImportEvals(orgId, makeInput(SOP_SLUG_RECONCILE, ["e-suite"]), {
      registry,
    });

    const rows = await getSuiteEvaluators(suiteId);

    // manual e-case row should survive; e-suite auto row should still be there
    expect(rows).toHaveLength(2);
    const manual = rows.find((r) => r.source === "manual");
    expect(manual).toBeDefined();
    expect(manual!.name).toBe("e-case");
  });
});

// ============================================================================
// Tests: empty common_evaluators
// ============================================================================

describe("import-evals — empty common_evaluators", () => {
  test("Test 7: empty common_evaluators yields no suite evaluator rows", async () => {
    const result = await handleImportEvals(
      orgId,
      makeInput(SOP_SLUG_EMPTY, []),
      { registry },
    );

    expect(result.suitesCreated).toBe(1);

    const suiteId = await getEvalSuiteId(SOP_SLUG_EMPTY);
    const rows = await getSuiteEvaluators(suiteId);

    expect(rows).toHaveLength(0);
  });
});
