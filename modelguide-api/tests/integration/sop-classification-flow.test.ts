/**
 * Full-flow integration test: SOP classification via compiled agent.
 *
 * Flow:
 * 1. Create a WISMO SOP and assign it to the agent
 * 2. Compile the agent (produces system prompt with Intent Classification section)
 * 3. Run the compiled agent against a sample WISMO email with:
 *    - Mocked store_look_up_order tool (deterministic fixture)
 *    - Real core_classify_sop tool (calls through app.fetch → session metadata)
 * 4. Verify the session's sop_classification metadata was written correctly
 */

import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agentSops, agents, sessionMessages, sessions, sops } from "@db/schema";
import { compile } from "@features/compiler/core/compile";
import type { CompilerInput } from "@features/compiler/core/types";
import { toMastra } from "@features/compiler/emitters/mastra";
import { classifySop } from "@features/mcp/mcp.service";
import { createTool } from "@mastra/core/tools";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { emailOrderNotArrivedSop } from "../fixtures/compiler/email-wismo-sop";
import { sampleGuardrails } from "../fixtures/compiler/sample-guardrails";
import { mockedToolResponses } from "../fixtures/compiler/test-emails";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// ============================================================================
// Setup
// ============================================================================

let s: TestSeed;
let adminHeaders: Record<string, string>;
let agentHeaders: Record<string, string>;

const cleanupSopIds: string[] = [];
const cleanupSessionIds: string[] = [];

function req(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

beforeAll(async () => {
  s = await getTestSeed();
  [adminHeaders, agentHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
  ]);

  // Enable core tools for the agent
  await forApp(async (tx) => {
    await tx
      .update(agents)
      .set({ metadata: { enableCoreAddMessages: true } })
      .where(eq(agents.id, s.orgAAgentId));
  });
});

afterAll(async () => {
  await forApp(async (tx) => {
    for (const id of cleanupSessionIds) {
      await tx.delete(sessionMessages).where(eq(sessionMessages.sessionId, id));
      await tx.delete(sessions).where(eq(sessions.id, id));
    }
    if (cleanupSopIds.length > 0) {
      await tx.delete(agentSops).where(inArray(agentSops.sopId, cleanupSopIds));
      await tx.delete(sops).where(inArray(sops.id, cleanupSopIds));
    }
    // Restore agent metadata
    await tx
      .update(agents)
      .set({ metadata: {}, compiledInstructions: null, compiledAt: null })
      .where(eq(agents.id, s.orgAAgentId));
  });
});

// ============================================================================
// Test
// ============================================================================

describe("SOP classification full flow", () => {
  let sopId: string;
  let sopSlug: string;

  test("1. create WISMO SOP and assign to agent", async () => {
    // Create the SOP via REST API — use a clean definition without tool
    // references (tool connectorToolIds from the fixture don't exist in the
    // test DB; tools are provided as Mastra toolsets at agent runtime)
    const res = await req("/api/sops", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "WISMO — Where Is My Order",
        slug: "wismo-flow-test",
        description:
          "Handle customer inquiries about order status and delivery",
        definition: {
          schemaVersion: 1,
          trigger: emailOrderNotArrivedSop.definition.trigger,
          steps: emailOrderNotArrivedSop.definition.steps.map((step) => ({
            id: step.id,
            order: step.order,
            instruction: step.instruction,
            required: step.required,
          })),
          metadata: emailOrderNotArrivedSop.definition.metadata,
        },
      }),
    });
    expect(res.status).toBe(201);
    const sop = await res.json();
    sopId = sop.id;
    sopSlug = sop.slug;
    cleanupSopIds.push(sopId);

    // Activate the SOP
    const activateRes = await req(`/api/sops/${sopId}/activate`, {
      method: "POST",
      headers: adminHeaders,
    });
    expect(activateRes.status).toBe(200);

    // Assign SOP to the agent
    const assignRes = await req(`/api/sops/${sopId}/agents`, {
      method: "PUT",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds: [s.orgAAgentId] }),
    });
    expect(assignRes.status).toBe(200);
  });

  it.skipIf(!HAS_API_KEY)(
    "2. compile + run agent — core_classify_sop writes to session via real service",
    async () => {
      // Create a real session first so core_classify_sop can write to it
      const createRes = await req("/api/sessions", {
        method: "POST",
        headers: { ...agentHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          channelType: "email",
          userIdentifier: "jane@example.com",
        }),
      });
      expect(createRes.status).toBe(201);
      const sessionData = await createRes.json();
      const sessionId = sessionData.id as string;
      cleanupSessionIds.push(sessionId);

      // Build core_classify_sop as a Mastra tool that calls the REAL service
      // — same code path as registerCoreTools in core-tools.ts
      const orgId = s.orgA.id;
      const agentId = s.orgAAgentId;

      const coreClassifySop = createTool({
        id: "core_classify_sop",
        description: "Classify the customer's intent by matching it to an SOP",
        inputSchema: z.object({
          session_id: z.string().optional(),
          sop_slug: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1),
        }),
        outputSchema: z.record(z.unknown()),
        // biome-ignore lint/suspicious/noExplicitAny: Mastra tool execute types
        execute: async (params: any) => {
          const input = params.context ?? params;
          // Same code path as the MCP tool handler in core-tools.ts
          return classifySop(
            orgId,
            agentId,
            input.session_id ?? sessionId,
            input.sop_slug ?? null,
            input.confidence ?? 0,
          ) as Promise<Record<string, unknown>>;
        },
      });

      // Compile with agent SOPs for intent classification
      const compilerInput: CompilerInput = {
        sops: [emailOrderNotArrivedSop],
        guardrails: sampleGuardrails,
        agentConfig: {
          id: agentId,
          name: "Classification Flow Test Agent",
          model: "anthropic/claude-haiku-4-5-20251001",
          description:
            "You are a customer support agent for an e-commerce store handling inbound support emails.",
        },
        agentSops: [
          {
            slug: sopSlug,
            name: "WISMO — Where Is My Order",
            description:
              "Handle customer inquiries about order status and delivery",
          },
        ],
      };

      const ir = compile(compilerInput);
      expect(ir.systemPrompt).toContain("## Intent Classification (Step 0)");
      expect(ir.systemPrompt).toContain(sopSlug);

      const { agent } = toMastra(ir);

      // Run against the WISMO email — agent should call core_classify_sop
      // which writes sop_classification to session metadata via real service
      const prompt = `From: jane@example.com\nSubject: Order still not here\n\nHi, it's been over a week and my order #1042 still hasn't shown up. Can you look into this?\n\n(session_id: ${sessionId})`;

      const result = await agent.generate(prompt, {
        toolsets: {
          modelguide: {
            store_look_up_order: createTool({
              id: "store_look_up_order",
              description:
                "Look up an order by order number and customer email",
              inputSchema: z.object({
                session_id: z.string().optional(),
                order_number: z.union([z.string(), z.number()]).optional(),
                customer_email: z.string().optional(),
                email: z.string().optional(),
              }),
              outputSchema: z.record(z.unknown()),
              execute: async () =>
                mockedToolResponses.store_look_up_order as Record<
                  string,
                  unknown
                >,
            }),
            helpdesk_create_ticket: createTool({
              id: "helpdesk_create_ticket",
              description: "Create a helpdesk support ticket",
              inputSchema: z.object({
                session_id: z.string().optional(),
                subject: z.string().optional(),
                body: z.string().optional(),
                requesterEmail: z.string().optional(),
                tags: z.array(z.string()).optional(),
                priority: z.string().optional(),
              }),
              outputSchema: z.record(z.unknown()),
              execute: async () =>
                mockedToolResponses.helpdesk_create_ticket as Record<
                  string,
                  unknown
                >,
            }),
            core_classify_sop: coreClassifySop,
          },
        },
        maxSteps: 8,
      });

      // Agent should have produced a text reply
      expect(result.text).toBeTruthy();

      // Verify sop_classification was written to session metadata by the real service
      const getRes = await req(`/api/sessions/${sessionId}`, {
        headers: adminHeaders,
      });
      expect(getRes.status).toBe(200);

      const detail = await getRes.json();
      const classification = detail.metadata?.sop_classification;

      expect(classification).toBeDefined();
      expect(classification.sop_slug).toBe(sopSlug);
      expect(typeof classification.confidence).toBe("number");
      expect(classification.confidence).toBeGreaterThanOrEqual(0.5);
      expect(classification.unknown).toBe(false);

      // Verify session appears in sopSlug-filtered list
      const listRes = await req(`/api/sessions?sopSlug=${sopSlug}`, {
        headers: adminHeaders,
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const found = listData.data.find(
        (s: { id: string }) => s.id === sessionId,
      );
      expect(found).toBeDefined();
    },
    30_000,
  );
});
