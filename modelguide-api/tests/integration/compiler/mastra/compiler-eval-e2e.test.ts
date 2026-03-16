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
import { toMastra } from "@features/compiler/emitters/mastra";
import { createEvalConfig } from "@features/eval-configs/eval-configs.service";
import { createSop } from "@features/sops/sops.service";
import { eq } from "drizzle-orm";
import { sampleGuardrails } from "../../../fixtures/compiler";
import { emailOrderNotArrivedSop } from "../../../fixtures/compiler/email-wismo-sop";
import {
  type E2EContext,
  agentConfig,
  buildSopSteps,
  compileAndRun,
  runEvalAndAssertAllPass,
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
    "happy path: WISMO email looks up order, does not escalate",
    async () => {
      // Given — evals: order lookup MUST fire, escalation MUST NOT, reply quality judged
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
      const replyJudge = await createEvalConfig(ctx.orgId, {
        name: "WISMO — llm_judge: reply references order and SLA",
        evaluatorType: "llm_judge",
        config: {
          criterion:
            "The agent reply references the customer's order number and mentions a delivery timeframe or SLA (e.g. working days). The tone is professional and helpful.",
          rubric: {
            pass: "Reply mentions order number AND delivery timeframe/SLA, tone is professional",
            fail: "Reply is missing order reference, delivery timeframe, or has unprofessional tone",
          },
          skipOnFailure: true,
        },
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
            replyJudgeEvalId: replyJudge.id,
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
      // Given — evals: escalation MUST fire, reply quality judged
      // Note: we don't assert no_tool_called on store_look_up_order — the agent
      // may reasonably look up the order before deciding to escalate.
      const lookupNoop = await createEvalConfig(ctx.orgId, {
        name: "Escalation — tool_called: store_look_up_order (optional)",
        evaluatorType: "tool_called",
        config: { connectorToolId: ctx.lookUpOrderToolId },
      });
      const escalateEval = await createEvalConfig(ctx.orgId, {
        name: "Escalation — tool_called: helpdesk_create_ticket",
        evaluatorType: "tool_called",
        config: { connectorToolId: ctx.createTicketToolId },
      });
      const replyJudge = await createEvalConfig(ctx.orgId, {
        name: "Escalation — llm_judge: reply acknowledges escalation",
        evaluatorType: "llm_judge",
        config: {
          criterion:
            "The agent reply acknowledges that the request is being escalated to the support team. It includes a ticket reference or mentions that someone will follow up. The tone is professional and reassuring.",
          rubric: {
            pass: "Reply confirms escalation with ticket reference or follow-up mention, tone is professional",
            fail: "Reply does not acknowledge escalation, or is missing ticket/follow-up details",
          },
          skipOnFailure: true,
        },
      });
      const sop = await createSop(ctx.orgId, {
        name: "Compiler E2E Escalation",
        slug: "compiler-e2e-escalation",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} as Record<string, never> },
          steps: buildSopSteps(ctx, {
            lookupEvalId: lookupNoop.id,
            escalationEvalId: escalateEval.id,
            replyJudgeEvalId: replyJudge.id,
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
