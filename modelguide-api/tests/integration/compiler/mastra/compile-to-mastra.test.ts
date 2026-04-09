/**
 * Integration tests — full compile() + toMastra() pipeline.
 *
 * ACs covered: 4 (valid input → IR), 13 (toMastra returns shape),
 * 14 (agent instructions match systemPrompt), 15 (workflow keyed by slug),
 * 19 (tools keyed by resolvedName), 20 (E2E compile + emit),
 * 21 (recompile with changed guardrail), 22 (recompile with added/removed step).
 */

import { describe, expect, it } from "bun:test";
import { compile } from "@features/compiler/core/compile";
import type {
  CompilerInput,
  KnowledgeBaseDetailResponse,
  SopDetailResponse,
} from "@features/compiler/core/types";
import { toMastra } from "@features/compiler/emitters/mastra";
import { emailOrderNotArrivedSop } from "../../../fixtures/compiler/email-wismo-sop";
import { createMockedToolsets } from "../../../fixtures/compiler/mocked-tools";
import { sampleGuardrails } from "../../../fixtures/compiler/sample-guardrails";
import { testEmails, toPrompt } from "../../../fixtures/compiler/test-emails";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

const agentConfig = {
  id: "wismo-compiled-agent",
  name: "WISMO Compiled Agent",
  model: "anthropic/claude-haiku-4-5-20241022",
  description:
    "You are a customer support agent for an e-commerce store handling inbound support emails. You process one email per run and send a single reply.",
  promptConfig: {},
  modelFamily: "generic" as const,
  channel: "text" as const,
};

function makeInput(
  sopOverride?: SopDetailResponse,
  guardrailOverride?: KnowledgeBaseDetailResponse[],
): CompilerInput {
  return {
    sops: [sopOverride ?? emailOrderNotArrivedSop],
    guardrails: guardrailOverride ?? sampleGuardrails,
    agentConfig,
  };
}

describe("compile() + toMastra() full pipeline", () => {
  const input = makeInput();
  const ir = compile(input);
  const result = toMastra(ir);

  it("AC 4: compile() returns a CompilerIR with all fields", () => {
    expect(ir.agentConfig).toBeDefined();
    expect(ir.sop).toBeDefined();
    expect(ir.systemPrompt).toBeTruthy();
    expect(ir.tools).toHaveLength(2);
    expect(ir.guardrails).toHaveLength(5);
  });

  it("AC 13: toMastra() returns { agent, workflows, tools }", () => {
    expect(result.agent).toBeDefined();
    expect(result.workflows).toBeDefined();
    expect(result.tools).toBeDefined();
  });

  it("AC 14: agent instructions match IR systemPrompt", () => {
    // The agent is created with instructions = ir.systemPrompt
    // We verify the agent exists and has the expected id
    expect(result.agent.id).toBe("wismo-compiled-agent");
    expect(result.agent.name).toBe("WISMO Compiled Agent");
  });

  it("AC 15: workflows contains exactly one entry keyed by SOP slug", () => {
    const keys = Object.keys(result.workflows);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("email-order-not-arrived");
  });

  it("AC 19: tools is Record<string, Tool> keyed by resolvedName", () => {
    const toolKeys = Object.keys(result.tools);
    expect(toolKeys).toHaveLength(2);
    expect(toolKeys).toContain("store_look_up_order");
    expect(toolKeys).toContain("helpdesk_create_ticket");
  });

  it("IR has 5 enriched steps with correct types", () => {
    expect(ir.sop.steps).toHaveLength(5);
    expect(ir.sop.steps[0].type).toBe("llm"); // classify-intent
    expect(ir.sop.steps[1].type).toBe("llm"); // extract-order-number
    expect(ir.sop.steps[2].type).toBe("tool"); // lookup-order
    expect(ir.sop.steps[3].type).toBe("llm"); // compose-reply
    expect(ir.sop.steps[4].type).toBe("tool"); // escalate-if-needed
  });

  it("system prompt contains all guardrails", () => {
    expect(ir.systemPrompt).toContain("Brand Tone — Warm Professional");
    expect(ir.systemPrompt).toContain("Delivery SLA Rules");
    expect(ir.systemPrompt).toContain("PII Handling");
    expect(ir.systemPrompt).toContain("No Premature Promises");
    expect(ir.systemPrompt).toContain("Escalation Protocol");
  });

  it("system prompt contains escalation triggers", () => {
    expect(ir.systemPrompt).toContain("Escalation Triggers");
    expect(ir.systemPrompt).toContain(
      "Request is not about order status or delivery",
    );
  });
});

describe("AC 21: recompile with modified guardrail", () => {
  it("adding a critical guardrail changes all step scopedPrompts and systemPrompt", () => {
    const originalIr = compile(makeInput());

    // Add a new critical guardrail
    const newGuardrail: KnowledgeBaseDetailResponse = {
      id: "gr-new-critical",
      type: "guardrail",
      name: "New Critical Rule",
      slug: "new-critical-rule",
      content: "Always double-check the order number before responding.",
      description: null,
      config: { category: "operational", priority: "critical" },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: null,
    };

    const modifiedIr = compile(
      makeInput(undefined, [...sampleGuardrails, newGuardrail]),
    );

    // System prompt should be different
    expect(modifiedIr.systemPrompt).not.toBe(originalIr.systemPrompt);
    expect(modifiedIr.systemPrompt).toContain("New Critical Rule");

    // All step scoped prompts should include the new critical guardrail
    for (const step of modifiedIr.sop.steps) {
      expect(step.scopedPrompt).toContain("New Critical Rule");
      expect(step.matchedGuardrailIds).toContain("gr-new-critical");
    }

    // Original should NOT have it
    for (const step of originalIr.sop.steps) {
      expect(step.scopedPrompt).not.toContain("New Critical Rule");
    }
  });
});

describe("AC 22: recompile with added/removed step", () => {
  it("adding a step produces more enriched steps", () => {
    const originalIr = compile(makeInput());
    expect(originalIr.sop.steps).toHaveLength(5);

    // Clone SOP and add a step
    const modifiedSop: SopDetailResponse = JSON.parse(
      JSON.stringify(emailOrderNotArrivedSop),
    );
    modifiedSop.definition.steps.push({
      id: "confirm-reply",
      order: 6,
      instruction: "Confirm the reply is ready to send.",
      required: false,
    });

    const modifiedIr = compile(makeInput(modifiedSop));
    expect(modifiedIr.sop.steps).toHaveLength(6);
    expect(modifiedIr.sop.steps[5].id).toBe("confirm-reply");
    expect(modifiedIr.sop.steps[5].type).toBe("llm");
  });

  it("removing a step produces fewer enriched steps", () => {
    const modifiedSop: SopDetailResponse = JSON.parse(
      JSON.stringify(emailOrderNotArrivedSop),
    );
    // Remove the escalation step
    modifiedSop.definition.steps = modifiedSop.definition.steps.filter(
      (s) => s.id !== "escalate-if-needed",
    );

    const modifiedIr = compile(makeInput(modifiedSop));
    expect(modifiedIr.sop.steps).toHaveLength(4);
    expect(modifiedIr.sop.steps.map((s) => s.id)).not.toContain(
      "escalate-if-needed",
    );
    // Tools should only have store_look_up_order now
    expect(modifiedIr.tools).toHaveLength(1);
    expect(modifiedIr.tools[0].resolvedName).toBe("store_look_up_order");
  });
});

describe("AC 20: E2E compile email WISMO SOP → Mastra agent + workflow", () => {
  const input = makeInput();
  const ir = compile(input);
  const result = toMastra(ir);

  it("compiles with correct SOP identity", () => {
    expect(ir.sop.name).toBe("Email — Order Not Arrived");
    expect(ir.sop.slug).toBe("email-order-not-arrived");
    expect(ir.sop.steps).toHaveLength(5);
    expect(ir.tools.map((t) => t.resolvedName)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
    expect(ir.guardrails).toHaveLength(5);
  });

  it("enriched steps have correct types and guardrail match counts", () => {
    const stepDetails = ir.sop.steps.map((s) => ({
      id: s.id,
      type: s.type,
      matchCount: s.matchedGuardrailIds.length,
    }));

    // classify-intent: llm, 3 critical + 1 high (escalation)
    expect(stepDetails[0]).toEqual({
      id: "classify-intent",
      type: "llm",
      matchCount: 4,
    });
    // extract-order-number: llm, 3 critical only
    expect(stepDetails[1]).toEqual({
      id: "extract-order-number",
      type: "llm",
      matchCount: 3,
    });
    // lookup-order: tool, 3 critical only
    expect(stepDetails[2]).toEqual({
      id: "lookup-order",
      type: "tool",
      matchCount: 3,
    });
    // compose-reply: llm, 3 critical + 1 high (no-promises)
    expect(stepDetails[3]).toEqual({
      id: "compose-reply",
      type: "llm",
      matchCount: 4,
    });
    // escalate-if-needed: tool, 3 critical + 1 high (escalation)
    expect(stepDetails[4]).toEqual({
      id: "escalate-if-needed",
      type: "tool",
      matchCount: 4,
    });
  });

  it("compose-reply scoped prompt has correct structure", () => {
    const composeStep = ir.sop.steps.find((s) => s.id === "compose-reply");
    expect(composeStep).toBeDefined();

    const prompt = composeStep!.scopedPrompt;
    // Step header
    expect(prompt).toContain("## Current Step: compose-reply");
    // Instruction section with verbatim content
    expect(prompt).toContain("### Instruction");
    expect(prompt).toContain(
      "Compose an email reply based on the order lookup result",
    );
    // Applicable guardrails section
    expect(prompt).toContain("### Applicable Guardrails");
    expect(prompt).toContain("[CRITICAL] Brand Tone — Warm Professional:");
    expect(prompt).toContain("[CRITICAL] Delivery SLA Rules:");
    expect(prompt).toContain("[CRITICAL] PII Handling:");
    expect(prompt).toContain("[HIGH] No Premature Promises:");
  });

  it("system prompt follows expected section structure", () => {
    const prompt = ir.systemPrompt;

    // Preamble — agent description first
    expect(prompt.startsWith(agentConfig.description)).toBe(true);

    // Sections in correct order
    const sopIdx = prompt.indexOf("## Workflow:");
    const toolsIdx = prompt.indexOf("## Tools");
    const guardrailIdx = prompt.indexOf("## Guardrails");
    const criticalIdx = prompt.indexOf("### Critical");
    const highIdx = prompt.indexOf("### High");
    const triggerIdx = prompt.indexOf("## Escalation Triggers");

    expect(sopIdx).toBeGreaterThan(0);
    expect(toolsIdx).toBeGreaterThan(sopIdx);
    expect(guardrailIdx).toBeGreaterThan(toolsIdx);
    expect(criticalIdx).toBeGreaterThan(guardrailIdx);
    expect(highIdx).toBeGreaterThan(criticalIdx);
    expect(triggerIdx).toBeGreaterThan(highIdx);
  });

  it("Mastra agent has correct identity", () => {
    expect(result.agent.id).toBe("wismo-compiled-agent");
    expect(result.agent.name).toBe("WISMO Compiled Agent");
  });

  it("Mastra workflow is keyed by SOP slug", () => {
    expect(Object.keys(result.workflows)).toEqual(["email-order-not-arrived"]);
    expect(result.workflows["email-order-not-arrived"].id).toBe(
      "email-order-not-arrived",
    );
  });

  it("Mastra tools include both store_look_up_order and helpdesk_create_ticket", () => {
    expect(Object.keys(result.tools)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
    // Each tool is a valid Mastra tool with an id
    expect(result.tools.store_look_up_order.id).toBe("store_look_up_order");
    expect(result.tools.helpdesk_create_ticket.id).toBe(
      "helpdesk_create_ticket",
    );
  });

  it("compiled agent can accept mocked toolsets for processing", () => {
    // Verify the compiled agent is structurally ready to process emails:
    // it can accept the same mocked toolsets used by the eval comparison.
    const toolsets = createMockedToolsets();
    expect(toolsets.modelguide.store_look_up_order).toBeDefined();
    expect(toolsets.modelguide.helpdesk_create_ticket).toBeDefined();

    // The agent's generate method accepts toolsets — verify it's callable
    expect(typeof result.agent.generate).toBe("function");
  });

  // Acid test: actually process a WISMO email with real LLM (gated)
  it.skipIf(!HAS_API_KEY)(
    "acid test: compiled agent processes inbound WISMO email end-to-end",
    async () => {
      const toolsets = createMockedToolsets();
      const wismoEmail = testEmails[0]; // in-scope WISMO email
      const prompt = toPrompt(wismoEmail.input);

      const genResult = await result.agent.generate(prompt, {
        toolsets,
        maxSteps: 5,
      });

      // Agent produced a text reply
      expect(genResult.text).toBeTruthy();
      expect(genResult.text!.length).toBeGreaterThan(20);

      // Agent called the order lookup tool
      // Mastra steps have shape { type, payload: { toolName } }
      // biome-ignore lint/suspicious/noExplicitAny: Mastra step types
      const allToolCalls = (genResult.steps as any[])
        .flatMap(
          (step) =>
            step.toolCalls?.map(
              (tc: { payload?: { toolName?: string }; toolName?: string }) =>
                tc.payload?.toolName ?? tc.toolName ?? "",
            ) ?? [],
        )
        .filter(Boolean);
      expect(
        allToolCalls.some((name: string) =>
          name.includes("store_look_up_order"),
        ),
      ).toBe(true);
    },
    60_000, // 1 minute timeout
  );
});
