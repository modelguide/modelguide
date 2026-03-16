/**
 * Compiler E2E — Compile → Run → Store → Eval.
 *
 * Fully self-contained: creates all DB fixtures, runs the compiled agent,
 * stores the session via services, runs evals via services, asserts scores,
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
import { compile } from "@features/compiler/core/compile";
import { toMastra } from "@features/compiler/emitters/mastra/index";
import { createEvalConfig } from "@features/eval-configs/eval-configs.service";
import { createSop } from "@features/sops/sops.service";
import { eq } from "drizzle-orm";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import {
  type E2EContext,
  agentConfig,
  buildSopSteps,
  compileAndRun,
  runEvalAndAssertAllPass,
  storeSession,
} from "../../fixtures/compiler/eval-helpers";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";

const HAS_API_KEY = !!process.env.OPENAI_API_KEY;

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
    "happy path: WISMO email looks up order, does not escalate",
    async () => {
      // Given — evals: order lookup MUST fire, escalation MUST NOT
      const lookupEval = await createEvalConfig(ctx.orgId, {
        name: "WISMO — tool_called: store_look_up_order",
        evaluatorType: "tool_called",
        config: { connectorToolId: ctx.lookUpOrderToolId },
      });
      const noEscalateEval = await createEvalConfig(ctx.orgId, {
        name: "WISMO — no_tool_called: helpdesk_create_ticket",
        evaluatorType: "no_tool_called",
        config: { connectorToolId: ctx.createTicketToolId },
      });
      const sop = await createSop(ctx.orgId, {
        name: "Compiler E2E WISMO",
        slug: "compiler-e2e-wismo",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} as Record<string, never> },
          steps: buildSopSteps(ctx, {
            lookupEvalId: lookupEval.id,
            escalationEvalId: noEscalateEval.id,
          }),
          metadata: {},
        },
      });

      // When — compile, run agent against in-scope email, store session
      const { prompt, result } = await compileAndRun(0);
      expect(result.text).toBeTruthy();
      expect(result.text!.length).toBeGreaterThan(20);
      const session = await storeSession(
        ctx,
        prompt,
        result,
        "wismo@test.local",
      );

      // Then — all eval scores pass
      await runEvalAndAssertAllPass(ctx, session.id, sop.id);
    },
    120_000,
  );

  it.skipIf(!HAS_API_KEY)(
    "unhappy path: refund request escalates via helpdesk_create_ticket",
    async () => {
      // Given — evals: escalation MUST fire, order lookup MUST NOT
      const noLookupEval = await createEvalConfig(ctx.orgId, {
        name: "Escalation — no_tool_called: store_look_up_order",
        evaluatorType: "no_tool_called",
        config: { connectorToolId: ctx.lookUpOrderToolId },
      });
      const escalateEval = await createEvalConfig(ctx.orgId, {
        name: "Escalation — tool_called: helpdesk_create_ticket",
        evaluatorType: "tool_called",
        config: { connectorToolId: ctx.createTicketToolId },
      });
      const sop = await createSop(ctx.orgId, {
        name: "Compiler E2E Escalation",
        slug: "compiler-e2e-escalation",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} as Record<string, never> },
          steps: buildSopSteps(ctx, {
            lookupEvalId: noLookupEval.id,
            escalationEvalId: escalateEval.id,
          }),
          metadata: {},
        },
      });

      // When — compile, run agent against out-of-scope email, store session
      const { prompt, result } = await compileAndRun(1);
      expect(result.text).toBeTruthy();
      expect(result.text!.length).toBeGreaterThan(20);
      const session = await storeSession(
        ctx,
        prompt,
        result,
        "escalation@test.local",
      );

      // Then — all eval scores pass
      await runEvalAndAssertAllPass(ctx, session.id, sop.id);
    },
    120_000,
  );
});
