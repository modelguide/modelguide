/**
 * Unit tests for dimension derivation helpers and tuple selection.
 *
 * Tests selectTuples() (in-process tuple selection) and toneToPersonaId().
 * deriveDimensionsFromSop() is LLM-dependent and tested via integration.
 */

import { describe, expect, test } from "bun:test";
import { getBuiltInPersona } from "@features/simulations/personas";
import {
  selectTuples,
  toneToPersonaId,
} from "@features/test-case-generation/dimensions";
import { TONES } from "@features/test-case-generation/types";
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
    "tool_returns_error",
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

  test("error edge cases get error tool states", () => {
    const tuples = selectTuples(dimsWithTools, { count: 50 });
    const errorEdgeCases = tuples.filter(
      (t) =>
        t.edgeCase === "tool_returns_error" ||
        t.edgeCase === "missing_order_number",
    );

    for (const t of errorEdgeCases) {
      // Every tool slug in the tuple should have an error variant
      for (const variant of Object.values(t.toolState)) {
        expect(variant.error === true || variant.error === "true").toBe(true);
      }
    }
  });

  test("straightforward edge cases get success tool states", () => {
    const tuples = selectTuples(dimsWithTools, { count: 50 });
    const straightforward = tuples.filter(
      (t) => t.edgeCase === "straightforward",
    );

    // Layer 1 systematically iterates all variants (including error),
    // but non-Layer-1 straightforward tuples should prefer success.
    // Soft check: at least some straightforward tuples have all-success states.

    // At least one straightforward tuple should have all-success tool states
    const allSuccess = straightforward.filter((t) =>
      Object.values(t.toolState).every(
        (v) => v.error !== true && v.error !== "true",
      ),
    );
    expect(allSuccess.length).toBeGreaterThan(0);
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
      "terse-buyer",
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

  test("polite maps to polite-buyer", () => {
    expect(toneToPersonaId("polite")).toBe("polite-buyer");
  });

  test("terse maps to terse-buyer", () => {
    expect(toneToPersonaId("terse")).toBe("terse-buyer");
  });

  test("each non-shared tone maps to a persona containing the tone name", () => {
    // Ensures persona IDs stay consistent with tone semantics
    expect(toneToPersonaId("polite")).toContain("polite");
    expect(toneToPersonaId("terse")).toContain("terse");
    expect(toneToPersonaId("confused")).toContain("confused");
  });

  test("every tone maps to a persona that exists in the persona registry", () => {
    for (const tone of TONES) {
      const personaId = toneToPersonaId(tone);
      const persona = getBuiltInPersona(personaId);
      expect(persona).toBeDefined();
      expect(persona!.id).toBe(personaId);
    }
  });

  test("unknown tone falls back to polite-buyer", () => {
    expect(toneToPersonaId("unknown_tone")).toBe("polite-buyer");
    expect(toneToPersonaId("")).toBe("polite-buyer");
  });
});
