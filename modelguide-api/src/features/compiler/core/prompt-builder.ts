/**
 * Prompt builder — assembles system prompt and per-step scoped prompts.
 *
 * All content comes from the compiler input. The builder owns only the
 * section structure (ordering, markdown formatting, priority grouping).
 * Template is hardcoded for Phase 1.
 *
 * See PRD Appendix A.3.1 for concrete output examples.
 */

import type { SopStep } from "@features/sops/sops.types";
import type {
  AgentSopInfo,
  GuardrailPriority,
  ParsedGuardrail,
  ResolvedTool,
} from "./types";

/** Minimal SOP shape for prompt building (avoids Zod inference type conflicts). */
interface SopForPrompt {
  name: string;
  description: string | null;
  definition: {
    steps: Array<{
      order: number;
      instruction: string;
      tool?: { resolvedName?: string };
    }>;
    metadata: {
      escalationTriggers?: string[];
    };
  };
}

// ============================================================================
// System prompt
// ============================================================================

/** Priority display order (critical first). */
const PRIORITY_ORDER: GuardrailPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/** Capitalize first letter of a priority for section headers. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the system prompt — set once as the agent's `instructions`.
 *
 * Structure:
 * 1. agentConfig.description (role context)
 * 2. ## Workflow: {name} + description
 * 3. ## Tools — bullet list of available tool names
 * 4. ## Guardrails grouped by priority (Critical, High, Medium, Low)
 * 5. ## Escalation Triggers as bullet list
 */
export function buildSystemPrompt(
  agentDescription: string,
  sop: SopForPrompt,
  guardrails: ParsedGuardrail[],
  tools: ResolvedTool[],
  agentSops?: AgentSopInfo[],
): string {
  const sections: string[] = [];

  // 1. Agent description (preamble)
  sections.push(agentDescription);

  // 1.5. Intent Classification (Step 0) — before workflow
  const classificationSection = buildIntentClassificationSection(agentSops);
  if (classificationSection) {
    sections.push(classificationSection);
  }

  // 2. SOP context
  sections.push(`## Workflow: ${sop.name}`);
  if (sop.description) {
    sections.push(sop.description);
  }

  // 2b. Steps
  const steps = sop.definition.steps;
  if (steps.length > 0) {
    const stepLines = steps
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        const toolSuffix = s.tool?.resolvedName
          ? ` → \`${s.tool.resolvedName}\``
          : "";
        return `${s.order}. ${s.instruction}${toolSuffix}`;
      });
    sections.push(`### Steps\n${stepLines.join("\n")}`);
  }

  // 3. Tools
  if (tools.length > 0) {
    sections.push("## Tools");
    sections.push(tools.map((t) => `- ${t.resolvedName}`).join("\n"));
  }

  // 4. Guardrails grouped by priority
  const guardrailsByPriority = groupByPriority(guardrails);
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

  // 5. Escalation triggers
  const triggers = sop.definition.metadata.escalationTriggers;
  if (triggers && triggers.length > 0) {
    sections.push("## Escalation Triggers");
    sections.push(triggers.map((t) => `- ${t}`).join("\n"));
  }

  return sections.join("\n\n");
}

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

// ============================================================================
// Intent classification
// ============================================================================

/**
 * Build the "## Intent Classification (Step 0)" section.
 * Returns null if no agent SOPs are available.
 */
export function buildIntentClassificationSection(
  agentSops?: AgentSopInfo[],
): string | null {
  if (!agentSops || agentSops.length === 0) return null;

  const sopList = agentSops
    .map((sop) => {
      const desc = sop.description ? `: ${sop.description}` : "";
      return `- \`${sop.slug}\` — ${sop.name}${desc}`;
    })
    .join("\n");

  return `## Intent Classification (Step 0)

Before executing any workflow steps, classify the customer's intent by calling \`core_classify_sop\`.

Available SOPs:
${sopList}

Call \`core_classify_sop\` with:
- \`sop_slug\`: the matching SOP slug from the list above (or null if no match)
- \`confidence\`: your confidence in the classification (0.0–1.0)
- \`session_id\`: the current session ID

Do not wait for the response before proceeding with the conversation.`;
}

// ============================================================================
// Helpers
// ============================================================================

function groupByPriority(
  guardrails: ParsedGuardrail[],
): Map<GuardrailPriority, ParsedGuardrail[]> {
  const map = new Map<GuardrailPriority, ParsedGuardrail[]>();
  for (const g of guardrails) {
    const priority = g.config.priority;
    const group = map.get(priority) ?? [];
    group.push(g);
    map.set(priority, group);
  }
  return map;
}
