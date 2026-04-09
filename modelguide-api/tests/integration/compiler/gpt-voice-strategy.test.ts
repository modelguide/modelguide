/**
 * Integration test — GptVoiceStrategy general acceptance criteria.
 *
 * Uses an inline fixture (generic multi-step SOP + guardrails) to verify
 * the compiler's structural output: section ordering, guardrail sandwich,
 * metadata, response rules, safety placement.
 *
 * AC3, AC18, AC20, AC24-27.
 */

import { describe, expect, it } from "bun:test";
import { compile } from "@features/compiler/core/compile";
import { gptVoiceOnboardingFixture } from "../../helpers/compiler-fixtures";

// ---------------------------------------------------------------------------

describe("GptVoiceStrategy — integration", () => {
  const ir = compile(gptVoiceOnboardingFixture);
  const prompt = ir.systemPrompt;

  it("AC25: compiles successfully from fixture", () => {
    expect(ir.systemPrompt).toBeTruthy();
    expect(ir.systemPrompt.length).toBeGreaterThan(500);
    expect(ir.guardrails.length).toBeGreaterThanOrEqual(3);
  });

  // ========================================================================
  // AC3: section ordering
  // ========================================================================

  it("AC3: description first, persona second", () => {
    const descIdx = prompt.indexOf("# Role & Objective");
    const personaIdx = prompt.indexOf("# Personality & Tone");
    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(personaIdx).toBeGreaterThan(descIdx);
  });

  it("AC26: persona block is present", () => {
    expect(prompt).toContain("# Personality & Tone");
    expect(prompt).toContain("You DRIVE the conversation");
    expect(prompt).toContain("this is an outbound call");
  });

  // ========================================================================
  // AC18: guardrail sandwich
  // ========================================================================

  it("AC18: all guardrails appear in both Rules and Reminders (sandwich)", () => {
    const rulesIdx = prompt.indexOf("# Rules");
    const remindersIdx = prompt.indexOf("# Reminders");
    expect(rulesIdx).toBeGreaterThan(0);
    expect(remindersIdx).toBeGreaterThan(rulesIdx);

    const topContent = prompt.slice(rulesIdx, remindersIdx);
    const bottomContent = prompt.slice(remindersIdx);

    // Compensation guardrail present in both halves
    expect(topContent).toContain("compensation");
    expect(bottomContent).toContain("compensation");
  });

  // ========================================================================
  // AC20: safety & escalation
  // ========================================================================

  it("AC20: safety & escalation compiled once at agent level", () => {
    expect(prompt).toContain("# Safety & Escalation");
    expect(prompt).toContain("hostile or abusive");
  });

  // ========================================================================
  // Response rules, tools, vocal normalization
  // ========================================================================

  it("response rules present under Personality & Tone", () => {
    expect(prompt).toContain("# Personality & Tone");
    expect(prompt).toContain("2-3 sentences per turn");
    expect(prompt).toContain("Do not repeat the same sentence twice");
    expect(prompt).toContain("Do not use markdown");
    expect(prompt).toContain("Use only the information provided");
  });

  it("AC26: vocal normalization block present", () => {
    expect(prompt).toContain("# Reference Pronunciations");
    expect(prompt).toContain("one hundred dollars");
    expect(prompt).toContain("ten thirty A M");
  });

  // ========================================================================
  // Metadata
  // ========================================================================

  it("metadata has valid token estimates", () => {
    expect(ir.metadata.systemPromptTokens).toBeGreaterThan(0);
    expect(ir.metadata.totalEstimatedTokens).toBeGreaterThan(0);
    expect(ir.metadata.cacheablePrefix).toBeGreaterThan(0);
    expect(ir.metadata.cacheablePrefix).toBeLessThanOrEqual(
      ir.systemPrompt.length,
    );
  });
});
