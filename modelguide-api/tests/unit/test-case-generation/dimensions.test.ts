/**
 * Unit tests for dimension derivation helpers and tuple selection.
 *
 * Tests selectTuples() (pure deterministic logic) and toneToPersonaId().
 * deriveDimensionsFromSop() is LLM-dependent and tested via integration.
 */

import { describe, expect, test } from "bun:test";
import {
  selectTuples,
  toneToPersonaId,
} from "@features/test-case-generation/dimensions";
import type { DimensionConfig } from "@features/test-case-generation/types";

// ============================================================================
// Fixtures
// ============================================================================

/** Minimal dimension config with tools. */
const dimsWithTools: DimensionConfig = {
  intents: ["order_status", "delivery_delay", "return_request"],
  tones: ["polite", "frustrated", "confused", "hostile", "terse"],
  complexity: ["single_step", "multi_step", "requires_escalation"],
  edgeCases: [
    "straightforward",
    "ambiguous_intent",
    "missing_order_number",
    "contradictory_request",
    "out_of_scope_request",
  ],
  toolStates: {
    glowbox_store_get_order: [
      { status: "delivered", tracking: "1Z999" },
      { status: "in_transit", eta: "2026-04-01" },
      { error: true, message: "Order not found" },
    ],
    glowbox_store_create_return: [
      { returnId: "RET-001", label: "https://..." },
      { error: true, message: "Item not eligible for return" },
      { returnId: "RET-002", label: "https://..." },
    ],
  },
};

/** Dimension config with no tool steps. */
const dimsNoTools: DimensionConfig = {
  intents: ["greeting", "farewell", "general_inquiry"],
  tones: ["polite", "frustrated", "confused", "hostile", "terse"],
  complexity: ["single_step", "multi_step", "requires_escalation"],
  edgeCases: [
    "straightforward",
    "ambiguous_intent",
    "off_topic",
    "multiple_questions",
    "language_barrier",
  ],
  toolStates: {},
};

// ============================================================================
// selectTuples
// ============================================================================

describe("selectTuples", () => {
  test("produces correct number of tuples up to count cap", () => {
    const tuples = selectTuples(dimsWithTools, { count: 20 });
    expect(tuples.length).toBeLessThanOrEqual(20);
    expect(tuples.length).toBeGreaterThan(0);
  });

  test("respects count cap when dimensions produce many combinations", () => {
    // With 3 intents * 2 tools * 3 variants each = 18 happy path alone
    // Plus edge cases, stress — should be capped
    const tuples = selectTuples(dimsWithTools, { count: 10 });
    expect(tuples.length).toBe(10);
  });

  test("deduplicates tuples — no identical combinations", () => {
    const tuples = selectTuples(dimsWithTools, { count: 50 });
    const keys = tuples.map(
      (t) =>
        `${t.intent}|${t.tone}|${t.complexity}|${t.edgeCase}|${JSON.stringify(t.toolState)}`,
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(tuples.length);
  });

  test("includes happy path tuples with 'straightforward' edge case", () => {
    const tuples = selectTuples(dimsWithTools, { count: 50 });
    const happyPath = tuples.filter((t) => t.edgeCase === "straightforward");
    expect(happyPath.length).toBeGreaterThan(0);
  });

  test("includes stress tuples with hard tones and requires_escalation", () => {
    const tuples = selectTuples(dimsWithTools, { count: 50 });
    const stress = tuples.filter(
      (t) =>
        (t.tone === "frustrated" || t.tone === "hostile") &&
        t.complexity === "requires_escalation" &&
        t.edgeCase !== "straightforward",
    );
    expect(stress.length).toBeGreaterThan(0);
  });

  test("each tuple has a toolState record with one variant per tool slug", () => {
    const tuples = selectTuples(dimsWithTools, { count: 30 });
    const toolSlugs = Object.keys(dimsWithTools.toolStates);
    for (const t of tuples) {
      for (const slug of toolSlugs) {
        expect(t.toolState[slug]).toBeDefined();
      }
    }
  });

  test("SOP with no tool steps produces tuples with empty toolState", () => {
    const tuples = selectTuples(dimsNoTools, { count: 15 });
    expect(tuples.length).toBeGreaterThan(0);
    for (const t of tuples) {
      expect(t.toolState).toEqual({});
    }
  });

  test("all tuples use values from the dimension config", () => {
    const tuples = selectTuples(dimsWithTools, { count: 30 });
    for (const t of tuples) {
      expect(dimsWithTools.intents).toContain(t.intent);
      expect(dimsWithTools.tones).toContain(t.tone);
      expect(dimsWithTools.complexity).toContain(t.complexity);
      expect(dimsWithTools.edgeCases).toContain(t.edgeCase);
    }
  });

  test("returns fewer tuples than requested when space is exhausted", () => {
    // Very small dimension space: 1 intent * 5 tones * 3 complexity * 1 edge * 1 tool variant
    const tiny: DimensionConfig = {
      intents: ["single_intent"],
      tones: ["polite", "frustrated", "confused", "hostile", "terse"],
      complexity: ["single_step", "multi_step", "requires_escalation"],
      edgeCases: ["straightforward"],
      toolStates: {},
    };
    // Max unique combos = 1 * 5 * 3 * 1 = 15
    const tuples = selectTuples(tiny, { count: 100 });
    expect(tuples.length).toBeLessThanOrEqual(15);
    expect(tuples.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// toneToPersonaId
// ============================================================================

describe("toneToPersonaId", () => {
  test("maps all 5 tones to valid persona IDs", () => {
    const validPersonas = [
      "impatient-returner",
      "confused-browser",
      "polite-buyer",
    ];

    for (const tone of [
      "polite",
      "frustrated",
      "confused",
      "hostile",
      "terse",
    ]) {
      const persona = toneToPersonaId(tone);
      expect(validPersonas).toContain(persona);
    }
  });

  test("frustrated and hostile map to impatient-returner", () => {
    expect(toneToPersonaId("frustrated")).toBe("impatient-returner");
    expect(toneToPersonaId("hostile")).toBe("impatient-returner");
  });

  test("confused maps to confused-browser", () => {
    expect(toneToPersonaId("confused")).toBe("confused-browser");
  });

  test("polite and terse map to polite-buyer", () => {
    expect(toneToPersonaId("polite")).toBe("polite-buyer");
    expect(toneToPersonaId("terse")).toBe("polite-buyer");
  });

  test("unknown tone falls back to polite-buyer", () => {
    expect(toneToPersonaId("unknown_tone")).toBe("polite-buyer");
    expect(toneToPersonaId("")).toBe("polite-buyer");
  });
});
