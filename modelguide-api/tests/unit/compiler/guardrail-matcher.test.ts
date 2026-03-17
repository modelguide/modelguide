/**
 * Unit tests for the guardrail matcher.
 *
 * ACs covered: 6 (critical in all steps), 7 (high by keyword overlap),
 * 8 (medium/low excluded), 9 (matchedGuardrailIds accurate).
 *
 * Verified against PRD Appendix A.3 expected matching table.
 *
 * NOTE: PRD A.3 claims compose-reply matches gr-escalation-001 via
 * "dissatisfaction" overlap, but compose-reply's instruction text does
 * not contain the word "dissatisfaction". This test reflects the actual
 * algorithm behavior, which is consistent with the keyword overlap spec.
 */

import { describe, expect, it } from "bun:test";
import {
  countOverlap,
  matchGuardrails,
  tokenize,
  tokensMatch,
} from "@features/compiler/core/guardrail-matcher";
import { parseGuardrails } from "@features/compiler/core/parse";
import type { ParsedGuardrail } from "@features/compiler/core/types";
import type { SopStep } from "@features/sops/sops.types";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";

const parsedGuardrails = parseGuardrails(sampleGuardrails);
const steps = emailOrderNotArrivedSop.definition.steps as SopStep[];

function getStep(id: string): SopStep {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`Step "${id}" not found`);
  return step;
}

function matchedIds(step: SopStep): string[] {
  return matchGuardrails(step, parsedGuardrails).map((g) => g.id);
}

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric", () => {
    const tokens = tokenize("Hello, World! This is a TEST.");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
    expect(tokens).not.toContain("this");
    expect(tokens).not.toContain("is");
  });

  it("filters tokens shorter than 3 chars", () => {
    const tokens = tokenize("I am ok no");
    expect(tokens).toEqual([]);
  });

  it("returns unique tokens", () => {
    const tokens = tokenize("scope scope scope ticket ticket");
    expect(tokens).toEqual(["scope", "ticket"]);
  });
});

describe("tokensMatch", () => {
  it("matches identical tokens", () => {
    expect(tokensMatch("scope", "scope")).toBe(true);
  });

  it("matches tokens sharing a 5+ char prefix", () => {
    expect(tokensMatch("escalate", "escalation")).toBe(true);
    expect(tokensMatch("promise", "promises")).toBe(true);
    expect(tokensMatch("refund", "refunds")).toBe(true);
    expect(tokensMatch("replacement", "replacing")).toBe(true);
  });

  it("rejects tokens with only 4-char prefix match", () => {
    // "extreme" and "extract" share "extr" (4 chars) but not 5
    expect(tokensMatch("extreme", "extract")).toBe(false);
  });

  it("rejects tokens shorter than 5 chars", () => {
    expect(tokensMatch("abcd", "abcdef")).toBe(false);
  });
});

describe("countOverlap", () => {
  it("counts unique matching token pairs", () => {
    const count = countOverlap(
      ["escalate", "scope", "ticket"],
      ["escalation", "scope", "something"],
    );
    expect(count).toBe(2); // escalate↔escalation, scope↔scope
  });

  it("each step token matched at most once", () => {
    const count = countOverlap(["scope", "scoped"], ["scope"]);
    expect(count).toBe(1); // only one match despite two guardrail tokens
  });
});

describe("matchGuardrails — Appendix A.3 verification", () => {
  const criticalIds = ["gr-tone-001", "gr-delivery-sla-001", "gr-pii-001"];

  it("AC 6: critical guardrails match ALL steps", () => {
    for (const step of steps) {
      const ids = matchedIds(step);
      for (const cid of criticalIds) {
        expect(ids).toContain(cid);
      }
    }
  });

  it("AC 8: medium/low guardrails never match any step", () => {
    const withMedium: ParsedGuardrail[] = [
      ...parsedGuardrails,
      {
        id: "gr-medium-test",
        name: "Medium Test",
        content: "scope ticket refund replacement escalation helpdesk",
        config: { category: "operational", priority: "medium" },
      },
    ];

    for (const step of steps) {
      const matched = matchGuardrails(step, withMedium);
      expect(matched.map((g) => g.id)).not.toContain("gr-medium-test");
    }
  });

  it("classify-intent: matches critical + gr-escalation-001", () => {
    const ids = matchedIds(getStep("classify-intent"));
    for (const cid of criticalIds) expect(ids).toContain(cid);
    expect(ids).toContain("gr-escalation-001");
    expect(ids).not.toContain("gr-no-promises-001");
  });

  it("extract-order-number: matches critical only", () => {
    const ids = matchedIds(getStep("extract-order-number"));
    for (const cid of criticalIds) expect(ids).toContain(cid);
    expect(ids).not.toContain("gr-no-promises-001");
    expect(ids).not.toContain("gr-escalation-001");
  });

  it("lookup-order: matches critical only", () => {
    const ids = matchedIds(getStep("lookup-order"));
    for (const cid of criticalIds) expect(ids).toContain(cid);
    expect(ids).not.toContain("gr-no-promises-001");
    expect(ids).not.toContain("gr-escalation-001");
  });

  it("compose-reply: matches critical + gr-no-promises-001", () => {
    const ids = matchedIds(getStep("compose-reply"));
    for (const cid of criticalIds) expect(ids).toContain(cid);
    // "refund", "replacement" overlap with no-promises guardrail
    expect(ids).toContain("gr-no-promises-001");
  });

  it("escalate-if-needed: matches critical + gr-escalation-001", () => {
    const ids = matchedIds(getStep("escalate-if-needed"));
    for (const cid of criticalIds) expect(ids).toContain(cid);
    expect(ids).toContain("gr-escalation-001");
  });
});
