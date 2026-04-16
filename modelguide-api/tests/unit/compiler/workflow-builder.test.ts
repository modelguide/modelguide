/**
 * Unit tests for the Mastra workflow builder.
 *
 * ACs covered: 15 (workflow keyed by slug), 16 (step count matches SOP).
 */

import { describe, expect, it } from "bun:test";
import { compile } from "@features/compiler/core/compile";
import type { CompilerInput } from "@features/compiler/core/types";
import { buildWorkflows } from "@features/compiler/emitters/mastra/workflow-builder";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";

const input: CompilerInput = {
  sops: [emailOrderNotArrivedSop],
  guardrails: sampleGuardrails,
  agentConfig: {
    id: "test-agent",
    name: "Test Agent",
    model: "openai:gpt-4o-mini",
    description: "Test agent",
    promptConfig: {},
    modelFamily: "generic" as const,
    modality: "text" as const,
  },
};

const ir = compile(input);

describe("buildWorkflows", () => {
  const workflows = buildWorkflows(
    ir.sops[0].slug,
    ir.sops[0].steps,
    ir.agentConfig.id,
  );

  it("AC 15: returns exactly one workflow keyed by SOP slug", () => {
    const keys = Object.keys(workflows);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("email-order-not-arrived");
  });

  it("AC 15: workflow has an id matching the SOP slug", () => {
    const workflow = workflows["email-order-not-arrived"];
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe("email-order-not-arrived");
  });

  it("handles single-step SOP", () => {
    const singleStep = [ir.sops[0].steps[0]];
    const wfs = buildWorkflows("single-step", singleStep, "test-agent");
    expect(Object.keys(wfs)).toHaveLength(1);
    expect(wfs["single-step"]).toBeDefined();
  });
});
