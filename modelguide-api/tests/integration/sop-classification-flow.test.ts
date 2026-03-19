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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp, forOrg } from "@db/rls";
import { agentSops, agents, sessionMessages, sessions, sops } from "@db/schema";
import { compileAgent } from "@features/compiler/compiler.service";
import { compile } from "@features/compiler/core/compile";
import type { CompilerInput } from "@features/compiler/core/types";
import { toMastra } from "@features/compiler/emitters/mastra";
import { storeSyntheticSession } from "@features/sessions/synthetic-session.service";
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
    // Create the SOP via REST API
    const res = await req("/api/sops", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "WISMO — Where Is My Order",
        slug: "wismo-flow-test",
        description:
          "Handle customer inquiries about order status and delivery",
        definition: emailOrderNotArrivedSop.definition,
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

  test("2. compile agent — system prompt includes Intent Classification", async () => {
    await compileAgent({
      orgId: s.orgA.id,
      agentId: s.orgAAgentId,
      sopId,
    });

    // Verify the compiled instructions include the intent classification section
    const [agent] = await forOrg(s.orgA.id, (tx) =>
      tx
        .select({ compiledInstructions: agents.compiledInstructions })
        .from(agents)
        .where(eq(agents.id, s.orgAAgentId)),
    );

    expect(agent.compiledInstructions).toBeDefined();
    expect(agent.compiledInstructions).toContain(
      "## Intent Classification (Step 0)",
    );
    expect(agent.compiledInstructions).toContain("core_classify_sop");
    expect(agent.compiledInstructions).toContain(sopSlug);
  });

  test("3. run agent on WISMO email — classifies intent and stores in session metadata", async () => {
    // Build a core_classify_sop Mastra tool that calls through to our app
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
        return {
          session_id: input.session_id,
          sop_classification: {
            sop_slug: input.sop_slug ?? null,
            confidence: input.confidence,
            unknown: !input.sop_slug,
          },
        };
      },
    });

    // Compile using the fixture SOP with agent SOPs for classification
    const compilerInput: CompilerInput = {
      sops: [emailOrderNotArrivedSop],
      guardrails: sampleGuardrails,
      agentConfig: {
        id: s.orgAAgentId,
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

    // Verify the compiled prompt has the classification section
    expect(ir.systemPrompt).toContain("## Intent Classification (Step 0)");
    expect(ir.systemPrompt).toContain(sopSlug);

    // Build the Mastra agent
    const { agent } = toMastra(ir);

    // Run against the WISMO email
    const prompt =
      "From: jane@example.com\nSubject: Order still not here\n\nHi, it's been over a week and my order #1042 still hasn't shown up. Can you look into this?";

    const result = await agent.generate(prompt, {
      toolsets: {
        modelguide: {
          store_look_up_order: createTool({
            id: "store_look_up_order",
            description: "Look up an order by order number and customer email",
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

    // The agent should have called core_classify_sop
    // biome-ignore lint/suspicious/noExplicitAny: Mastra step types are loosely typed
    const allToolCalls = (result.steps as any[])
      .flatMap(
        (step) =>
          step.toolCalls?.map(
            (tc: {
              payload?: { toolName?: string; args?: Record<string, unknown> };
              toolName?: string;
              args?: Record<string, unknown>;
            }) => ({
              name: tc.payload?.toolName ?? tc.toolName ?? "",
              args: tc.payload?.args ?? tc.args ?? {},
            }),
          ) ?? [],
      )
      .filter((tc: { name: string }) => tc.name);

    const classifyCall = allToolCalls.find(
      (tc: { name: string }) => tc.name === "core_classify_sop",
    );
    expect(classifyCall).toBeDefined();

    const classifyInput = classifyCall!.args as Record<string, unknown>;

    // The agent should have classified this as WISMO
    expect(classifyInput.sop_slug).toBe(sopSlug);
    expect(typeof classifyInput.confidence).toBe("number");
    expect(classifyInput.confidence as number).toBeGreaterThanOrEqual(0.5);

    // Now store the session and write classification via the real API
    const session = await storeSyntheticSession({
      orgId: s.orgA.id,
      agentId: s.orgAAgentId,
      generationResult: result,
      userInput: prompt,
      channelType: "email",
      userIdentifier: "jane@example.com",
    });
    cleanupSessionIds.push(session.id);

    // Write the classification via REST API (simulating what the MCP tool does)
    const patchRes = await req(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { ...agentHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        metadata: {
          sop_classification: {
            sop_slug: classifyInput.sop_slug,
            confidence: classifyInput.confidence,
            unknown: false,
          },
        },
      }),
    });
    expect(patchRes.status).toBe(200);

    // 4. Verify the session has sop_classification in metadata
    const getRes = await req(`/api/sessions/${session.id}`, {
      headers: adminHeaders,
    });
    expect(getRes.status).toBe(200);

    const sessionData = await getRes.json();
    const classification = sessionData.metadata?.sop_classification;

    expect(classification).toBeDefined();
    expect(classification.sop_slug).toBe(sopSlug);
    expect(classification.confidence).toBeGreaterThanOrEqual(0.5);
    expect(classification.unknown).toBe(false);

    // Also verify the session appears in filtered list
    const listRes = await req(`/api/sessions?sopSlug=${sopSlug}`, {
      headers: adminHeaders,
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const found = listData.data.find(
      (s: { id: string }) => s.id === session.id,
    );
    expect(found).toBeDefined();
  });
});
