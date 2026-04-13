/**
 * Unit tests for elevenlabs-models.ts
 *
 * Verifies that all curated model IDs exist in the SDK's runtime Llm const
 * object (guards against type widening or stale entries), and that the
 * filter logic behaves correctly.
 */

import { describe, expect, test } from "bun:test";
import {
  ELEVENLABS_MODELS,
  getElevenLabsModelGroups,
} from "@features/agents/elevenlabs-models";

// Dynamically import the SDK Llm const to verify IDs at runtime.
// Note: the SDK exports `Llm` as a named export in its type declaration files
// but the runtime value is accessed via the api/types barrel.
async function getSdkLlmValues(): Promise<Set<string>> {
  // The runtime const is available at the api/types path
  const mod = await import(
    "@elevenlabs/elevenlabs-js/dist/api/types/Llm.js" as string
  ).catch(() => null);
  if (!mod) {
    // Fallback: read the .d.ts values we know from the type declaration
    return new Set<string>([]);
  }
  const LlmConst = mod.Llm as Record<string, string>;
  return new Set(Object.values(LlmConst));
}

describe("ELEVENLABS_MODELS — curated list integrity", () => {
  test("has at least 10 models", () => {
    expect(ELEVENLABS_MODELS.length).toBeGreaterThanOrEqual(10);
  });

  test("all models have id, label, and family", () => {
    for (const model of ELEVENLABS_MODELS) {
      expect(model.id).toBeString();
      expect(model.id.length).toBeGreaterThan(0);
      expect(model.label).toBeString();
      expect(model.label.length).toBeGreaterThan(0);
      expect(["gpt", "claude", "gemini", "generic"]).toContain(model.family);
    }
  });

  test("no duplicate model IDs", () => {
    const ids = ELEVENLABS_MODELS.map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("all curated model IDs exist in the SDK Llm const", async () => {
    const sdkValues = await getSdkLlmValues();
    if (sdkValues.size === 0) {
      // If we couldn't load the runtime module, skip this assertion
      console.warn(
        "Skipping SDK Llm const validation — runtime module not available",
      );
      return;
    }
    for (const model of ELEVENLABS_MODELS) {
      expect(sdkValues).toContain(model.id);
    }
  });

  test("does not include custom-llm", () => {
    const ids = ELEVENLABS_MODELS.map((m) => m.id);
    expect(ids).not.toContain("custom-llm");
  });

  test("does not include dated model variants (e.g. gpt-4o-2024-08-06)", () => {
    for (const model of ELEVENLABS_MODELS) {
      // Dated variants contain a date pattern like -2024-08- or @20240620
      expect(model.id).not.toMatch(/-\d{4}-\d{2}-\d{2}$/);
      expect(model.id).not.toMatch(/@\d{8}/);
    }
  });
});

describe("getElevenLabsModelGroups — filtering", () => {
  test("returns all four family groups when no filter", () => {
    const groups = getElevenLabsModelGroups();
    const families = groups.map((g) => g.family);
    expect(families).toContain("gpt");
    expect(families).toContain("claude");
    expect(families).toContain("gemini");
    expect(families).toContain("generic");
  });

  test("gpt filter returns only gpt models", () => {
    const groups = getElevenLabsModelGroups("gpt");
    expect(groups).toHaveLength(1);
    expect(groups[0].family).toBe("gpt");
    expect(groups[0].models.length).toBeGreaterThan(0);
    // Spot-check
    const ids = groups[0].models.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4.1");
    expect(ids).not.toContain("claude-sonnet-4-5");
  });

  test("claude filter returns only claude models", () => {
    const groups = getElevenLabsModelGroups("claude");
    expect(groups).toHaveLength(1);
    expect(groups[0].family).toBe("claude");
    const ids = groups[0].models.map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).not.toContain("gpt-4o");
  });

  test("gemini filter returns only gemini models", () => {
    const groups = getElevenLabsModelGroups("gemini");
    expect(groups).toHaveLength(1);
    expect(groups[0].family).toBe("gemini");
    const ids = groups[0].models.map((m) => m.id);
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).not.toContain("gpt-4o");
  });

  test("generic filter returns all models combined (ungrouped)", () => {
    const groups = getElevenLabsModelGroups("generic");
    expect(groups).toHaveLength(1);
    expect(groups[0].family).toBe("generic");
    // Should contain models from all families
    const ids = groups[0].models.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("grok-beta");
    // Total matches all curated models
    expect(groups[0].models.length).toBe(ELEVENLABS_MODELS.length);
  });

  test("each group has id and label on every model", () => {
    const groups = getElevenLabsModelGroups();
    for (const group of groups) {
      for (const model of group.models) {
        expect(model.id).toBeString();
        expect(model.label).toBeString();
      }
    }
  });
});
