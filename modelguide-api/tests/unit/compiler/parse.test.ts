/**
 * Unit tests for the parse stage.
 *
 * ACs covered: 1 (invalid schemaVersion), 2 (missing resolvedName),
 * 3 (invalid guardrail config), 4 (valid input passes), 11 (unique tools).
 */

import { describe, expect, it } from "bun:test";
import {
  CompilerError,
  parseGuardrails,
  parseSop,
} from "@features/compiler/core/parse";
import type {
  KnowledgeBaseDetailResponse,
  SopDetailResponse,
} from "@features/compiler/core/types";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";

// Helper to deep-clone a fixture
function cloneSop(sop: SopDetailResponse): SopDetailResponse {
  return JSON.parse(JSON.stringify(sop));
}

describe("parseSop", () => {
  it("AC 4: accepts a valid SOP and returns tools", () => {
    const { sop, tools } = parseSop([emailOrderNotArrivedSop]);
    expect(sop.id).toBe("sop-email-order-not-arrived-001");
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.resolvedName)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
  });

  it("AC 11: tools array has no duplicates", () => {
    // Create a SOP with duplicate tool references
    const sop = cloneSop(emailOrderNotArrivedSop);
    // Add another step referencing the same tool
    sop.definition.steps.push({
      id: "extra-lookup",
      order: 6,
      instruction: "Look up the order again",
      required: false,
      tool: {
        connectorToolId: "00000000-0000-0000-0000-000000000001",
        connectorId: "00000000-0000-0000-0000-000000000010",
        resolvedName: "store_look_up_order",
      },
    });

    const { tools } = parseSop([sop]);
    const resolvedNames = tools.map((t) => t.resolvedName);
    expect(resolvedNames).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
  });

  it("rejects when not exactly one SOP is provided", () => {
    expect(() => parseSop([])).toThrow(CompilerError);
    expect(() => parseSop([])).toThrow("exactly one SOP");
    expect(() =>
      parseSop([emailOrderNotArrivedSop, emailOrderNotArrivedSop]),
    ).toThrow("exactly one SOP");
  });

  it("AC 1: rejects an SOP with invalid schemaVersion", () => {
    const sop = cloneSop(emailOrderNotArrivedSop);
    // @ts-expect-error — intentionally invalid
    sop.definition.schemaVersion = 2;

    expect(() => parseSop([sop])).toThrow(CompilerError);
    expect(() => parseSop([sop])).toThrow("Invalid SOP definition");
  });

  it("AC 2: rejects a step with tool but no resolvedName", () => {
    const sop = cloneSop(emailOrderNotArrivedSop);
    // Remove resolvedName from the lookup step
    const lookupStep = sop.definition.steps.find(
      (s) => s.id === "lookup-order",
    );
    if (lookupStep?.tool) {
      (lookupStep.tool as Record<string, unknown>).resolvedName = undefined;
    }

    expect(() => parseSop([sop])).toThrow(CompilerError);
    expect(() => parseSop([sop])).toThrow("no resolvedName");
  });
});

describe("parseGuardrails", () => {
  it("AC 4: accepts valid guardrails and narrows config", () => {
    const parsed = parseGuardrails(sampleGuardrails);
    expect(parsed).toHaveLength(5);
    expect(parsed[0].config.priority).toBe("critical");
    expect(parsed[0].config.category).toBe("brand");
  });

  it("AC 3: rejects guardrails with invalid priority", () => {
    const invalid: KnowledgeBaseDetailResponse[] = [
      {
        ...sampleGuardrails[0],
        config: { priority: "urgent", category: "brand" },
      },
    ];

    expect(() => parseGuardrails(invalid)).toThrow(CompilerError);
    expect(() => parseGuardrails(invalid)).toThrow("Invalid guardrail config");
  });

  it("AC 3: rejects guardrails with invalid category", () => {
    const invalid: KnowledgeBaseDetailResponse[] = [
      {
        ...sampleGuardrails[0],
        config: { priority: "critical", category: "unknown" },
      },
    ];

    expect(() => parseGuardrails(invalid)).toThrow(CompilerError);
  });
});
