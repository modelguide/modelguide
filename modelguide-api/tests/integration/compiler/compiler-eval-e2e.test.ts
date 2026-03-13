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
import { runEvaluation } from "@features/evals/evals.service";
import {
  addMessage,
  createSession,
  updateSession,
} from "@features/sessions/sessions.service";
import { createSop } from "@features/sops/sops.service";
import { getLogger } from "@lib/logger";
import { eq } from "drizzle-orm";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { createMockedToolsets } from "../../fixtures/compiler/mocked-tools";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";
import { testEmails, toPrompt } from "../../fixtures/compiler/test-emails";

const HAS_API_KEY = !!process.env.OPENAI_API_KEY;

const agentConfig = {
  id: "compiler-e2e-agent",
  name: "Compiler E2E Agent",
  model: "openai/gpt-4o-mini",
  description:
    "You are a customer support agent for an e-commerce store handling inbound support emails. You process one email per run and send a single reply.",
};

// ============================================================================
// Fixture IDs — populated in beforeAll, cleaned up in afterAll
// ============================================================================

let orgId: string;
let agentId: string;
let lookUpOrderToolId: string;
let createTicketToolId: string;

// ============================================================================
// Setup — create isolated org with connectors + tools
// ============================================================================

beforeAll(async () => {
  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Compiler E2E Test Org", slug: "compiler-e2e-test" })
      .returning();
    orgId = org.id;

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: orgId,
        name: "Compiler E2E Agent",
        slug: "compiler-e2e-agent",
        modality: "text",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });
    agentId = agent.id;

    // Look up catalog IDs (global, created by migration seed)
    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));
    const [zendesk] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "zendesk"));

    // Connector slugs "store" and "helpdesk" match the compiled agent's
    // tool name prefixes: store_look_up_order, helpdesk_create_ticket
    const [storeConn] = await tx
      .insert(connectors)
      .values({
        organizationId: orgId,
        connectorCatalogId: medusa.id,
        name: "Store",
        slug: "store",
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
    lookUpOrderToolId = lookUpTool.id;

    const [helpdeskConn] = await tx
      .insert(connectors)
      .values({
        organizationId: orgId,
        connectorCatalogId: zendesk.id,
        name: "Helpdesk",
        slug: "helpdesk",
      })
      .returning({ id: connectors.id });

    const [ticketTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: orgId,
        connectorId: helpdeskConn.id,
        name: "Create Ticket",
        slug: "create_ticket",
      })
      .returning({ id: connectorTools.id });
    createTicketToolId = ticketTool.id;
  });
});

// ============================================================================
// Cleanup — cascade-delete org removes everything
// ============================================================================

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

describe("Compiler E2E: compile → run → store → eval", () => {
  // Test 1: Compile fixture SOP → Mastra agent (no LLM, no DB needed)
  it("compiles fixture SOP into Mastra agent with expected tools", () => {
    const ir = compile({
      sops: [emailOrderNotArrivedSop],
      guardrails: sampleGuardrails,
      agentConfig,
    });
    const result = toMastra(ir);

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

  // Test 2: Full E2E — compile → run agent → store session → run eval
  it.skipIf(!HAS_API_KEY)(
    "full E2E: compile → run → store session → eval scores pass",
    async () => {
      // --- Create eval configs + SOP in DB ---
      const lookupEvalCfg = await createEvalConfig(orgId, {
        name: "WISMO — tool_called: store_look_up_order",
        evaluatorType: "tool_called",
        config: { connectorToolId: lookUpOrderToolId },
      });

      const noEscalateEvalCfg = await createEvalConfig(orgId, {
        name: "WISMO — no_tool_called: helpdesk_create_ticket",
        evaluatorType: "no_tool_called",
        config: { connectorToolId: createTicketToolId },
      });

      const sop = await createSop(orgId, {
        name: "Compiler E2E WISMO",
        slug: "compiler-e2e-wismo",
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
              tool: { connectorToolId: lookUpOrderToolId },
              evalConfigId: lookupEvalCfg.id,
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
              tool: { connectorToolId: createTicketToolId },
              evalConfigId: noEscalateEvalCfg.id,
            },
          ],
          metadata: {},
        },
      });

      // --- Compile + run agent ---
      const ir = compile({
        sops: [emailOrderNotArrivedSop],
        guardrails: sampleGuardrails,
        agentConfig,
      });
      const { agent } = toMastra(ir);
      const prompt = toPrompt(testEmails[0].input);

      const genResult = await agent.generate(prompt, {
        toolsets: createMockedToolsets(),
        maxSteps: 5,
      });

      expect(genResult.text).toBeTruthy();
      expect(genResult.text!.length).toBeGreaterThan(20);

      // --- Store agent output as session ---
      const session = await createSession(orgId, agentId, {
        channelType: "email",
        userIdentifier: "compiler-e2e@test.local",
      });

      await addMessage(orgId, session.id, agentId, {
        role: "user",
        content: prompt,
      });

      // biome-ignore lint/suspicious/noExplicitAny: Mastra step types are loosely typed
      for (const step of genResult.steps as any[]) {
        const toolCalls =
          step.toolCalls?.map(
            (tc: {
              payload?: { toolName?: string };
              toolName?: string;
              toolCallId?: string;
              args?: Record<string, unknown>;
              result?: unknown;
            }) => ({
              toolCallId: tc.toolCallId ?? crypto.randomUUID(),
              toolName: tc.payload?.toolName ?? tc.toolName ?? "unknown",
              toolInput: tc.args ?? {},
              toolOutput:
                typeof tc.result === "object" && tc.result !== null
                  ? (tc.result as Record<string, unknown>)
                  : { result: tc.result },
              toolStatus: "success" as const,
            }),
          ) ?? [];

        if (step.text || toolCalls.length > 0) {
          await addMessage(orgId, session.id, agentId, {
            role: "assistant",
            content: step.text ?? undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        }
      }

      await updateSession(orgId, session.id, agentId, {
        status: "completed",
      });

      // --- Run eval + assert ---
      const evalResult = await runEvaluation(orgId, session.id, "sop", sop.id);

      const log = getLogger().child(
        { test: "compiler-eval-e2e" },
        { level: "info" },
      );
      log.info(
        {
          runId: evalResult.id,
          status: evalResult.status,
          passed: evalResult.passed,
          durationMs: evalResult.durationMs,
          scores: evalResult.scores.map((s) => ({
            result: s.result,
            evaluatorType: s.evaluatorType,
            name: s.name,
            reasoning: s.reasoning,
          })),
        },
        "eval run completed",
      );

      expect(evalResult.status).toBe("completed");
      expect(evalResult.passed).toBe(true);

      const toolCalledScore = evalResult.scores.find(
        (s) => s.evaluatorType === "tool_called",
      );
      const noToolCalledScore = evalResult.scores.find(
        (s) => s.evaluatorType === "no_tool_called",
      );

      expect(toolCalledScore).toBeDefined();
      expect(toolCalledScore!.result).toBe("pass");
      expect(noToolCalledScore).toBeDefined();
      expect(noToolCalledScore!.result).toBe("pass");
    },
    120_000,
  );
});
