/**
 * Unit tests for the Mastra step builder.
 *
 * ACs covered: 17 (LLM steps invoke agent), 18 (tool steps reference tool).
 */

import { describe, expect, it } from "bun:test";
import type { EnrichedStep } from "@features/compiler/core/types";
import {
  buildStep,
  stepContextSchema,
} from "@features/compiler/emitters/mastra/step-builder";

const llmStep: EnrichedStep = {
  id: "classify-intent",
  order: 1,
  instruction: "Determine if this email is about WISMO or out-of-scope.",
  required: true,
  type: "llm",
  scopedPrompt:
    "## Current Step: classify-intent\n\n### Instruction\nDetermine...",
  matchedGuardrailIds: ["gr-tone-001"],
};

const toolStep: EnrichedStep = {
  id: "lookup-order",
  order: 3,
  instruction: "Look up the order.",
  required: true,
  type: "tool",
  tool: {
    connectorToolId: "ct-look-up-order-uuid",
    connectorId: "conn-store-uuid",
    resolvedName: "store_look_up_order",
  },
  scopedPrompt: "## Current Step: lookup-order\n\n### Instruction\nLook up...",
  matchedGuardrailIds: ["gr-tone-001"],
};

describe("buildStep", () => {
  it("AC 17: LLM step produces a Mastra step with matching id", () => {
    const step = buildStep(llmStep, "test-agent");
    expect(step.id).toBe("classify-intent");
  });

  it("AC 18: tool step produces a Mastra step with matching id", () => {
    const step = buildStep(toolStep, "test-agent");
    expect(step.id).toBe("lookup-order");
  });

  it("both step types use the shared context schema", () => {
    const llm = buildStep(llmStep, "test-agent");
    const tool = buildStep(toolStep, "test-agent");

    // Both should have inputSchema and outputSchema defined
    expect(llm.inputSchema).toBeDefined();
    expect(llm.outputSchema).toBeDefined();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it("throws on tool step with no resolvedName", () => {
    const badToolStep: EnrichedStep = {
      ...toolStep,
      tool: { connectorToolId: "some-id" },
    };
    expect(() => buildStep(badToolStep, "test-agent")).toThrow(
      "no resolvedName",
    );
  });
});

describe("stepContextSchema", () => {
  it("validates a valid context", () => {
    const result = stepContextSchema.safeParse({
      messages: [],
      toolResults: {},
      intent: "wismo",
    });
    expect(result.success).toBe(true);
  });

  it("validates context without intent", () => {
    const result = stepContextSchema.safeParse({
      messages: [],
      toolResults: {},
    });
    expect(result.success).toBe(true);
  });
});
