/**
 * Unit tests for the prompt builder.
 *
 * ACs covered: 6-8 (guardrail placement in prompts),
 * 10 (system prompt groups by priority), 12 (escalation triggers).
 */

import { describe, expect, it } from "bun:test";
import { parseGuardrails } from "@features/compiler/core/parse";
import {
  buildScopedPrompt,
  buildSystemPrompt,
} from "@features/compiler/core/prompt-builder";
import type { ResolvedTool } from "@features/compiler/core/types";
import type { SopStep } from "@features/sops/sops.types";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";

const parsedGuardrails = parseGuardrails(sampleGuardrails);
const agentDescription =
  "You are a customer support agent for an e-commerce store handling inbound support emails. You process one email per run and send a single reply.";

const sampleTools: ResolvedTool[] = [
  {
    resolvedName: "store_look_up_order",
    connectorToolId: "ct-1",
    connectorId: "c-1",
  },
  {
    resolvedName: "helpdesk_create_ticket",
    connectorToolId: "ct-2",
    connectorId: "c-2",
  },
];

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(
    agentDescription,
    emailOrderNotArrivedSop,
    parsedGuardrails,
    sampleTools,
  );

  it("starts with agentConfig.description as preamble", () => {
    expect(prompt.startsWith(agentDescription)).toBe(true);
  });

  it("includes SOP name and description", () => {
    expect(prompt).toContain("## Workflow: Email — Order Not Arrived");
    expect(prompt).toContain("Process inbound emails about orders");
  });

  it("includes steps subsection with numbered instructions", () => {
    expect(prompt).toContain("### Steps");
    expect(prompt).toContain("1. Determine if this email is about an order");
    expect(prompt).toContain("3. Look up the order");
  });

  it("appends tool name to steps that have tools", () => {
    expect(prompt).toContain("→ `store_look_up_order`");
    expect(prompt).toContain("→ `helpdesk_create_ticket`");
    // Steps without tools should not have arrows
    expect(prompt).toMatch(/1\. Determine if this email.*(?<!→)/);
  });

  it("includes tools section with resolved names", () => {
    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("- store_look_up_order");
    expect(prompt).toContain("- helpdesk_create_ticket");
  });

  it("omits tools section when no tools provided", () => {
    const noToolsPrompt = buildSystemPrompt(
      agentDescription,
      emailOrderNotArrivedSop,
      parsedGuardrails,
      [],
    );
    expect(noToolsPrompt).not.toContain("## Tools");
  });

  it("AC 10: groups guardrails by priority with critical first", () => {
    const criticalIdx = prompt.indexOf("### Critical");
    const highIdx = prompt.indexOf("### High");
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(highIdx).toBeGreaterThan(-1);
    expect(criticalIdx).toBeLessThan(highIdx);
  });

  it("AC 10: includes all guardrails in the system prompt", () => {
    expect(prompt).toContain("Brand Tone — Warm Professional");
    expect(prompt).toContain("Delivery SLA Rules");
    expect(prompt).toContain("PII Handling");
    expect(prompt).toContain("No Premature Promises");
    expect(prompt).toContain("Escalation Protocol");
  });

  it("AC 12: includes escalation triggers", () => {
    expect(prompt).toContain("## Escalation Triggers");
    expect(prompt).toContain("- Request is not about order status or delivery");
    expect(prompt).toContain(
      "- Order lookup fails or returns unexpected error",
    );
    expect(prompt).toContain(
      "- Customer expresses extreme dissatisfaction after SLA explanation",
    );
  });

  it("formats guardrails as **name:** content", () => {
    expect(prompt).toContain(
      "**Brand Tone — Warm Professional:** Always greet the customer",
    );
  });
});

describe("buildScopedPrompt", () => {
  const step: SopStep = {
    id: "compose-reply",
    order: 4,
    instruction: "Compose an email reply based on the order lookup result.",
    required: true,
  };

  const matched = parsedGuardrails.filter(
    (g) => g.config.priority === "critical" || g.id === "gr-no-promises-001",
  );

  const prompt = buildScopedPrompt(step, matched);

  it("includes step header", () => {
    expect(prompt).toContain("## Current Step: compose-reply");
  });

  it("includes step instruction verbatim", () => {
    expect(prompt).toContain("### Instruction");
    expect(prompt).toContain(
      "Compose an email reply based on the order lookup result.",
    );
  });

  it("includes matched guardrails with priority labels", () => {
    expect(prompt).toContain("### Applicable Guardrails");
    expect(prompt).toContain("[CRITICAL] Brand Tone — Warm Professional:");
    expect(prompt).toContain("[HIGH] No Premature Promises:");
  });

  it("orders guardrails: critical before high", () => {
    const criticalIdx = prompt.indexOf("[CRITICAL]");
    const highIdx = prompt.indexOf("[HIGH]");
    expect(criticalIdx).toBeLessThan(highIdx);
  });

  it("omits guardrails section when none matched", () => {
    const emptyPrompt = buildScopedPrompt(step, []);
    expect(emptyPrompt).not.toContain("### Applicable Guardrails");
  });
});
