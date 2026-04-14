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
  parseSops,
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

describe("parseSops", () => {
  it("AC 4: accepts a valid SOP and returns tools", () => {
    const { sops, tools } = parseSops([emailOrderNotArrivedSop]);
    expect(sops[0].id).toBe("sop-email-order-not-arrived-001");
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.resolvedName)).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
  });

  it("accepts multiple SOPs", () => {
    const sop2 = cloneSop(emailOrderNotArrivedSop);
    sop2.id = "sop-2";
    sop2.name = "Second SOP";
    const { sops } = parseSops([emailOrderNotArrivedSop, sop2]);
    expect(sops).toHaveLength(2);
  });

  it("AC 11: tools array has no duplicates across SOPs", () => {
    // Create a second SOP referencing the same tools
    const sop2 = cloneSop(emailOrderNotArrivedSop);
    sop2.id = "sop-dup";
    sop2.name = "Dup SOP";

    const { tools } = parseSops([emailOrderNotArrivedSop, sop2]);
    const resolvedNames = tools.map((t) => t.resolvedName);
    expect(resolvedNames).toEqual([
      "store_look_up_order",
      "helpdesk_create_ticket",
    ]);
  });

  it("accepts a SOP with no tool steps (conversational-only)", () => {
    const sop = cloneSop(emailOrderNotArrivedSop);
    // Remove all tool references — pure conversational SOP
    for (const step of sop.definition.steps) {
      step.tool = undefined;
    }

    const { sops, tools } = parseSops([sop]);
    expect(sops[0].id).toBe("sop-email-order-not-arrived-001");
    expect(tools).toHaveLength(0);
  });

  it("rejects when zero SOPs are provided", () => {
    expect(() => parseSops([])).toThrow(CompilerError);
    expect(() => parseSops([])).toThrow("at least one SOP");
  });

  it("AC 1: rejects an SOP with invalid schemaVersion", () => {
    const sop = cloneSop(emailOrderNotArrivedSop);
    // @ts-expect-error — intentionally invalid
    sop.definition.schemaVersion = 2;

    expect(() => parseSops([sop])).toThrow(CompilerError);
    expect(() => parseSops([sop])).toThrow("Invalid SOP definition");
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

    expect(() => parseSops([sop])).toThrow(CompilerError);
    expect(() => parseSops([sop])).toThrow("no resolvedName");
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
