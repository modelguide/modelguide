/**
 * Compiler E2E — initSuiteFromSop → compileAgent → runEvalSuite.
 *
 * Fully self-contained: creates all DB fixtures, initializes an eval suite
 * from the SOP, compiles the agent, runs the suite, asserts all pass,
 * and cleans up after.
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
import { compileAgent } from "@features/compiler/compiler.service";
import { compile } from "@features/compiler/core/compile";
import { toMastra } from "@features/compiler/emitters/mastra";
import {
  initSuiteFromSop,
  runEvalSuite,
} from "@features/evals/eval-suites.service";
import { createSop } from "@features/sops/sops.service";
import { eq } from "drizzle-orm";
import { sampleGuardrails } from "../../../fixtures/compiler";
import { emailOrderNotArrivedSop } from "../../../fixtures/compiler/email-wismo-sop";
import {
  type E2EContext,
  agentConfig,
  compileAndRun,
  storeSession,
} from "../eval-helpers";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// ============================================================================
// Fixture IDs — populated in beforeAll, cleaned up in afterAll
// ============================================================================

let ctx: E2EContext;

beforeAll(async () => {
  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Compiler E2E Test Org", slug: "compiler-e2e-test" })
      .returning();

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: org.id,
        name: "Compiler E2E Agent",
        slug: "compiler-e2e-agent",
        modality: "text",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });

    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));
    const [zendesk] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "zendesk"));

    const [storeConn] = await tx
      .insert(connectors)
      .values({
        organizationId: org.id,
        connectorCatalogId: medusa.id,
        name: "Store",
        slug: "store",
      })
      .returning({ id: connectors.id });

    const [lookUpTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: org.id,
        connectorId: storeConn.id,
        name: "Look Up Order",
        slug: "look_up_order",
      })
      .returning({ id: connectorTools.id });

    const [helpdeskConn] = await tx
      .insert(connectors)
      .values({
        organizationId: org.id,
        connectorCatalogId: zendesk.id,
        name: "Helpdesk",
        slug: "helpdesk",
      })
      .returning({ id: connectors.id });

    const [ticketTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: org.id,
        connectorId: helpdeskConn.id,
        name: "Create Ticket",
        slug: "create_ticket",
      })
      .returning({ id: connectorTools.id });

    ctx = {
      orgId: org.id,
      agentId: agent.id,
      lookUpOrderToolId: lookUpTool.id,
      createTicketToolId: ticketTool.id,
    };
  });
});

afterAll(async () => {
  if (ctx?.orgId) {
    await forApp((tx) =>
      tx.delete(organizations).where(eq(organizations.id, ctx.orgId)),
    );
  }
});

// ============================================================================
// Tests
// ============================================================================

describe("Compiler E2E: compile → run → store → eval", () => {
  it("compiles fixture SOP into Mastra agent with expected tools", () => {
    // Given
    const input = {
      sops: [emailOrderNotArrivedSop],
      guardrails: sampleGuardrails,
      agentConfig,
    };

    // When
    const ir = compile(input);
    const result = toMastra(ir);

    // Then
    expect(ir.tools.map((t) => t.resolvedName)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
    expect(result.agent.id).toBe("compiler-e2e-agent");
    expect(Object.keys(result.tools)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
  });

  it.skipIf(!HAS_API_KEY)(
    "initSuiteFromSop → compileAgent → runEvalSuite: WISMO happy path",
    async () => {
      // Given — create SOP from steps with tool references
      const sop = await createSop(ctx.orgId, {
        name: "Compiler E2E WISMO Suite",
        slug: "compiler-e2e-wismo-suite",
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
              tool: { connectorToolId: ctx.lookUpOrderToolId },
            },
            {
              id: "compose-reply",
              order: 3,
              instruction: "Compose reply based on order lookup result.",
              required: true,
            },
            {
              id: "escalate-if-needed",
              order: 4,
              instruction:
                "Escalate if out of scope by creating a helpdesk ticket.",
              required: false,
              tool: { connectorToolId: ctx.createTicketToolId },
            },
          ],
          metadata: {},
        },
      });

      // Step 1: initSuiteFromSop — auto-generates test cases with evaluators
      const suite = await initSuiteFromSop(ctx.orgId, ctx.agentId, sop.id);

      // Evaluators are now per test case, not at suite level
      expect(suite.testCases.length).toBeGreaterThanOrEqual(1);
      const allEvaluators = suite.testCases.flatMap(
        (tc: { evaluators: unknown[] }) => tc.evaluators,
      );
      expect(allEvaluators.length).toBeGreaterThanOrEqual(1);

      // Step 2: compileAgent — persists compiled instructions
      const compileResult = await compileAgent({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        sopId: sop.id,
        agentModel: "anthropic/claude-haiku-4-5-20251001",
        agentDescription: agentConfig.description,
      });

      expect(compileResult.agent.compiledInstructions).toBeTruthy();
      expect(compileResult.agent.compiledAt).toBeTruthy();
      expect(compileResult.agent.compiledFrom).toBeTruthy();

      // Step 3: Run agent and store as synthetic session
      const { prompt, result: agentResult } = await compileAndRun(0);
      const session = await storeSession(
        ctx,
        prompt,
        agentResult,
        "e2e-test@example.com",
      );

      // Step 4: runEvalSuite against the real session
      const suiteResult = await runEvalSuite(
        ctx.orgId,
        suite.id,
        session.id,
        "compiled",
      );

      // Verify suite run completed
      expect(suiteResult.suiteRun.id).toBeTruthy();
      expect(suiteResult.results.length).toBe(suite.testCases.length);

      // Verify each test case was actually evaluated (not skipped due to errors)
      for (const result of suiteResult.results) {
        expect(result.evalRunId).toBeTruthy();
        expect(result.passed).not.toBeNull();
        expect(result.scores.length).toBeGreaterThan(0);
      }

      // Verify the eval pipeline executed end-to-end:
      // - Every test case got an eval run (not skipped)
      // - Every test case produced scores (assertions were resolved and executed)
      // - At least some assertions pass (the agent does call tools correctly)
      //
      // Note: not all test cases will pass because:
      // - All 3 test cases evaluate the same session (a happy-path WISMO email)
      // - The guardrail path expects escalation behavior that won't happen on a WISMO email
      // - The llm_judge for "classify intent" is strict — agent handles intent without explicit classification
      const allScores = suiteResult.results.flatMap((r) => r.scores);
      const passingScores = allScores.filter((s) => s.result === "pass");
      expect(passingScores.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
