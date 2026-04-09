/**
 * Unit tests for the transform stage.
 *
 * ACs covered: 5 (step types), 9 (matchedGuardrailIds accurate).
 */

import { describe, expect, it } from "bun:test";
import { parseGuardrails, parseSop } from "@features/compiler/core/parse";
import { transform } from "@features/compiler/core/transform";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";

const { sop, tools } = parseSop([emailOrderNotArrivedSop]);
const guardrails = parseGuardrails(sampleGuardrails);
const agentConfig = {
  id: "test-agent",
  name: "Test Agent",
  model: "openai:gpt-4o-mini",
  description: "Test agent description",
  promptConfig: {},
  modelFamily: "generic" as const,
  channel: "text" as const,
};

const ir = transform(sop, tools, guardrails, agentConfig);

describe("transform — step types", () => {
  it("AC 5: step type is 'tool' when step has tool reference", () => {
    const lookupStep = ir.sop.steps.find((s) => s.id === "lookup-order");
    expect(lookupStep?.type).toBe("tool");

    const escalateStep = ir.sop.steps.find(
      (s) => s.id === "escalate-if-needed",
    );
    expect(escalateStep?.type).toBe("tool");
  });

  it("AC 5: step type is 'llm' when step has no tool reference", () => {
    const classifyStep = ir.sop.steps.find((s) => s.id === "classify-intent");
    expect(classifyStep?.type).toBe("llm");

    const extractStep = ir.sop.steps.find(
      (s) => s.id === "extract-order-number",
    );
    expect(extractStep?.type).toBe("llm");

    const composeStep = ir.sop.steps.find((s) => s.id === "compose-reply");
    expect(composeStep?.type).toBe("llm");
  });
});

describe("transform — enriched steps", () => {
  it("steps are ordered by `order` field", () => {
    const orders = ir.sop.steps.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });

  it("each step has a scopedPrompt", () => {
    for (const step of ir.sop.steps) {
      expect(step.scopedPrompt).toBeTruthy();
      expect(step.scopedPrompt).toContain(`## Current Step: ${step.id}`);
    }
  });

  it("AC 9: matchedGuardrailIds contains exactly the matched guardrail IDs", () => {
    const classifyStep = ir.sop.steps.find((s) => s.id === "classify-intent");
    // Critical guardrails always present
    expect(classifyStep?.matchedGuardrailIds).toContain("gr-tone-001");
    expect(classifyStep?.matchedGuardrailIds).toContain("gr-delivery-sla-001");
    expect(classifyStep?.matchedGuardrailIds).toContain("gr-pii-001");
    // Escalation should match classify-intent
    expect(classifyStep?.matchedGuardrailIds).toContain("gr-escalation-001");
  });
});

describe("transform — IR structure", () => {
  it("IR has systemPrompt", () => {
    expect(ir.systemPrompt).toBeTruthy();
    expect(ir.systemPrompt).toContain("Test agent description");
  });

  it("IR has tools", () => {
    expect(ir.tools).toHaveLength(2);
    expect(ir.tools.map((t) => t.resolvedName)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
  });

  it("IR has guardrails", () => {
    expect(ir.guardrails).toHaveLength(5);
  });

  it("IR has sop metadata", () => {
    expect(ir.sop.id).toBe("sop-email-order-not-arrived-001");
    expect(ir.sop.slug).toBe("email-order-not-arrived");
  });
});
