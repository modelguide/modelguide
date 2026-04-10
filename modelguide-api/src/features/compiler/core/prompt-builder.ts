/**
 * Prompt builder — per-step scoped prompts.
 *
 * buildScopedPrompt is used by the transform stage to enrich each
 * SOP step with matched guardrails.
 */

import type { SopStep } from "@features/sops/sops.types";
import type { GuardrailPriority, ParsedGuardrail } from "./types";

/** Priority display order (critical first). */
const PRIORITY_ORDER: GuardrailPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

// ============================================================================
// Scoped prompt (per-step)
// ============================================================================

/**
 * Build the scoped prompt for a single step.
 *
 * Structure:
 * 1. ## Current Step: {step.id}
 * 2. ### Instruction — step.instruction verbatim
 * 3. ### Applicable Guardrails — matched guardrails with priority labels
 */
export function buildScopedPrompt(
  step: SopStep,
  matchedGuardrails: ParsedGuardrail[],
): string {
  const sections: string[] = [];

  // 1. Step header
  sections.push(`## Current Step: ${step.id}`);

  // 2. Instruction
  sections.push("### Instruction");
  sections.push(step.instruction);

  // 3. Matched guardrails (ordered: critical first, then high)
  if (matchedGuardrails.length > 0) {
    sections.push("### Applicable Guardrails");
    const sorted = [...matchedGuardrails].sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.config.priority) -
        PRIORITY_ORDER.indexOf(b.config.priority),
    );
    for (const g of sorted) {
      sections.push(
        `**[${g.config.priority.toUpperCase()}] ${g.name}:** ${g.content}`,
      );
    }
  }

  return sections.join("\n\n");
}
