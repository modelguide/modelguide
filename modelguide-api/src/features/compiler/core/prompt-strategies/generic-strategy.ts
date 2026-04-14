/**
 * GenericStrategy — backward-compatible prompt format.
 *
 * Produces the same markdown output as Phase 1. Used as fallback for all
 * (modelFamily, modality) combinations that don't have a dedicated strategy.
 */

import type {
  GuardrailPriority,
  ParsedGuardrail,
  TransformResult,
} from "../types";
import type { PromptStrategy, StrategyOutput } from "./types";

/** Priority display order (critical first). */
const PRIORITY_ORDER: GuardrailPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function groupByPriority(
  guardrails: ParsedGuardrail[],
): Map<GuardrailPriority, ParsedGuardrail[]> {
  const map = new Map<GuardrailPriority, ParsedGuardrail[]>();
  for (const g of guardrails) {
    const group = map.get(g.config.priority) ?? [];
    group.push(g);
    map.set(g.config.priority, group);
  }
  return map;
}

export class GenericStrategy implements PromptStrategy {
  readonly name = "GenericStrategy";

  buildPrompt(ir: TransformResult): StrategyOutput {
    const sections: string[] = [];

    // 1. Agent description (preamble)
    sections.push(ir.agentConfig.description);

    // 2. SOP sections — one per SOP
    for (const sop of ir.sops) {
      sections.push(`## Workflow: ${sop.name}`);
      if (sop.description) {
        sections.push(sop.description);
      }

      // Steps
      const steps = sop.definition.steps;
      if (steps.length > 0) {
        const stepLines = steps
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((s) => {
            const toolSuffix = s.tool?.resolvedName
              ? ` → \`${s.tool.resolvedName}\``
              : "";
            const requiredTag = s.required ? " *(required)*" : "";
            return `${s.order}. ${s.instruction}${toolSuffix}${requiredTag}`;
          });
        const enforcement =
          "Follow these steps in order. Every step must be reflected in your response — do not skip steps.";
        sections.push(`### Steps\n${enforcement}\n${stepLines.join("\n")}`);
      }
    }

    // 3. Tools (deduped across all SOPs — already deduped at parse stage)
    if (ir.tools.length > 0) {
      sections.push("## Tools");
      sections.push(ir.tools.map((t) => `- ${t.resolvedName}`).join("\n"));
    }

    // 4. Guardrails grouped by priority
    const guardrailsByPriority = groupByPriority(ir.guardrails);
    const guardrailSections: string[] = [];

    for (const priority of PRIORITY_ORDER) {
      const group = guardrailsByPriority.get(priority);
      if (!group || group.length === 0) continue;

      guardrailSections.push(`### ${capitalize(priority)}`);
      for (const g of group) {
        guardrailSections.push(`**${g.name}:** ${g.content}`);
      }
    }

    if (guardrailSections.length > 0) {
      sections.push("## Guardrails");
      sections.push(guardrailSections.join("\n\n"));
    }

    // 5. Escalation triggers — merged and deduped across all SOPs
    const allTriggers = new Set<string>();
    for (const sop of ir.sops) {
      const triggers = sop.definition.metadata.escalationTriggers;
      if (triggers) {
        for (const t of triggers) {
          allTriggers.add(t);
        }
      }
    }
    if (allTriggers.size > 0) {
      sections.push("## Escalation Triggers");
      sections.push([...allTriggers].map((t) => `- ${t}`).join("\n"));
    }

    const prompt = sections.join("\n\n");

    // Generic strategy: entire prompt is static (no Reminders section)
    return { prompt, cacheablePrefix: prompt.length, warnings: [] };
  }
}
