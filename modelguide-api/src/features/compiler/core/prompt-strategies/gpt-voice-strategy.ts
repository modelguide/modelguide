/**
 * GptVoiceStrategy — optimized for GPT Realtime voice agents.
 *
 * Section ordering follows the OpenAI Realtime Prompting Guide:
 *   # Role & Objective
 *   # Personality & Tone (persona + response rules)
 *   # Reference Pronunciations (vocal normalization)
 *   # Tools (filler preamble, hallucination guard, per-tool blocks)
 *   # Rules (all guardrails as bullets)
 *   # Conversation Flow (SOP steps with GOAL/EXIT)
 *   # Safety & Escalation
 *   # Reminders (all guardrails repeated — sandwich technique)
 *
 * Key conventions:
 * - Markdown # headers for sections (model reads these, not TTS)
 * - No markdown in model OUTPUT (AC13) — but system prompt uses markdown structure
 * - All guardrails rendered uniformly and repeated in Reminders (sandwich)
 * - Safety & escalation at agent level, not per SOP step
 */

import { getLogger } from "@lib/logger";
import type {
  CompilerWarning,
  EnrichedStep,
  ParsedGuardrail,
  PromptConfig,
  ResolvedTool,
  TransformResult,
} from "../types";
import type { PromptStrategy, StrategyOutput } from "./types";

/** Max tokens per tool block before warning (chars / 4). */
const TOOL_BLOCK_TOKEN_LIMIT = 60;

const DEFAULT_FILLER_PHRASES = [
  "One moment.",
  "Let me check.",
  "Just a second.",
  "I'm looking into that.",
];

/**
 * Rewrite symbolic operators to plain English for small voice models.
 * E.g. `> 240` → "more than 240", `!= null` → "exists".
 */
function normalizeSymbolicOperators(text: string): string {
  return (
    text
      // Comparison with null
      .replace(/!=\s*null/gi, "exists")
      .replace(/==\s*null/gi, "does not exist")
      // Comparison operators with numbers (order matters: >= before >)
      .replace(/>=\s*(\d+)/g, "at least $1")
      .replace(/<=\s*(\d+)/g, "at most $1")
      .replace(/>\s*(\d+)/g, "more than $1")
      .replace(/<\s*(\d+)/g, "less than $1")
      // Equality with quoted or unquoted values
      .replace(/!=\s*"([^"]+)"/g, 'is not "$1"')
      .replace(/==\s*"([^"]+)"/g, 'equals "$1"')
      .replace(/!=\s*(\w+)/g, "is not $1")
      .replace(/==\s*(\w+)/g, "equals $1")
  );
}

export class GptVoiceStrategy implements PromptStrategy {
  readonly name = "GptVoiceStrategy";

  buildPrompt(ir: TransformResult): StrategyOutput {
    const { agentConfig, sop, guardrails, tools } = ir;
    const warnings: CompilerWarning[] = [];

    const staticSections = [
      this.renderRoleAndObjective(agentConfig.description),
      this.renderPersonalityAndTone(agentConfig.promptConfig),
      this.renderReferencePronunciations(),
      this.renderTools(tools, agentConfig.promptConfig, warnings),
      this.renderRules(guardrails),
      this.renderConversationFlow(sop.steps),
      this.renderSafetyAndEscalation(
        sop.definition.metadata?.escalationTriggers,
      ),
    ].filter(Boolean);

    const staticContent = staticSections.join("\n\n");
    const cacheablePrefix = staticContent.length;

    const reminders = this.renderReminders(guardrails);
    const prompt = reminders
      ? `${staticContent}\n\n${reminders}`
      : staticContent;

    // AC19: No agentic boilerplate (persistence/tool-calling/planning) — intentionally omitted

    return { prompt, cacheablePrefix, warnings };
  }

  /** 1. Role & Objective — AC3: description first */
  private renderRoleAndObjective(description: string): string {
    return `# Role & Objective\nYou are ${description}.`;
  }

  /** 2. Personality & Tone — AC3: persona second, AC11-14: response rules */
  private renderPersonalityAndTone(promptConfig: PromptConfig): string {
    const lines: string[] = ["# Personality & Tone"];

    if (promptConfig.persona) {
      lines.push(promptConfig.persona);
      lines.push("");
    }

    lines.push("- Keep responses to 2-3 sentences per turn.");
    lines.push("- Do not repeat the same sentence twice. Vary your responses.");
    lines.push(
      "- Do not use markdown, bullet points, lists, or any text formatting in your responses. Speak only in natural sentences meant to be read aloud.",
    );
    lines.push(
      "- Use only the information provided — do not supplement with general knowledge.",
    );

    if (promptConfig.language) {
      lines.push("");
      lines.push("## Language");
      lines.push(promptConfig.language);
    }

    return lines.join("\n");
  }

  /** 3. Reference Pronunciations — AC10: vocal normalization */
  private renderReferencePronunciations(): string {
    return [
      "# Reference Pronunciations",
      "When speaking numbers, dates, and symbols aloud:",
      '- Dollar amounts: say "one hundred dollars" not "$100"',
      '- Times: say "ten thirty A M" not "10:30am"',
      '- Ordinals: say "second" not "2nd"',
    ].join("\n");
  }

  /** 4. Tools — AC6, AC16, AC17 */
  private renderTools(
    tools: ResolvedTool[],
    promptConfig: PromptConfig,
    warnings: CompilerWarning[],
  ): string {
    const lines: string[] = ["# Tools"];

    if (tools.length === 0) {
      lines.push("No tools assigned.");
      return lines.join("\n");
    }

    const fillers =
      promptConfig.fillerPhrases && promptConfig.fillerPhrases.length > 0
        ? promptConfig.fillerPhrases
        : DEFAULT_FILLER_PHRASES;

    lines.push(
      `Approved filler phrases while tools execute: ${fillers.map((f) => `"${f}"`).join(", ")}`,
    );
    lines.push("- Never use the same filler twice in a row.");
    lines.push(
      "- If you don't have enough information to call a tool, ask the user before calling it.",
    );

    for (const tool of tools) {
      const block = this.renderToolBlock(tool);
      const blockTokens = Math.ceil(block.length / 4);
      if (blockTokens > TOOL_BLOCK_TOKEN_LIMIT) {
        warnings.push({
          code: "TOOL_BLOCK_OVER_BUDGET",
          message: `Tool "${tool.resolvedName}" block is ~${blockTokens} tokens (limit: ${TOOL_BLOCK_TOKEN_LIMIT})`,
          tokens: blockTokens,
        });
      }
      lines.push("");
      lines.push(block);
    }

    return lines.join("\n");
  }

  /** 5. Rules — full content for detailed guidance in cached prefix */
  private renderRules(guardrails: ParsedGuardrail[]): string | null {
    if (guardrails.length === 0) return null;

    const lines: string[] = [
      "# Rules",
      "Rules below may contain illustrative examples in parentheses (e.g., …). These are templates only — use ONLY data from the Role Context above.",
    ];
    for (const g of guardrails) {
      lines.push(`\n## ${g.name}`);
      lines.push(g.content);
    }

    return lines.join("\n");
  }

  /** 6. Conversation Flow — AC15: SOP steps with GOAL/EXIT */
  private renderConversationFlow(steps: EnrichedStep[]): string {
    const lines: string[] = ["# Conversation Flow"];
    const sorted = steps.slice().sort((a, b) => a.order - b.order);

    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      const stepLabel = step.id
        ? `Step ${step.order}: ${step.id}`
        : `Step ${step.order}`;
      const nextLabel =
        i < sorted.length - 1 ? `Step ${sorted[i + 1].order}` : "End";

      lines.push("");
      lines.push(`## ${stepLabel}`);
      if (step.id) {
        const goal = step.id
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`GOAL: ${goal}`);
      }
      lines.push(normalizeSymbolicOperators(step.instruction));
      lines.push(`EXIT → ${nextLabel}`);
    }

    return lines.join("\n");
  }

  /** 7. Safety & Escalation — AC20: compiled once at agent level */
  private renderSafetyAndEscalation(
    triggers: string[] | undefined,
  ): string | null {
    if (!triggers || triggers.length === 0) {
      getLogger().warn(
        "no escalation triggers defined — Safety & Escalation section omitted from voice prompt",
      );
      return null;
    }

    const lines: string[] = ["# Safety & Escalation"];
    for (const trigger of triggers) {
      lines.push(`- ${trigger}`);
    }

    return lines.join("\n");
  }

  /** 8. Reminders — all guardrails repeated (sandwich technique) */
  private renderReminders(guardrails: ParsedGuardrail[]): string | null {
    if (guardrails.length === 0) return null;

    const lines: string[] = ["# Reminders"];
    for (const g of guardrails) {
      lines.push(`\n## ${g.name}`);
      lines.push(g.description ?? g.content);
    }

    return lines.join("\n");
  }

  /** Render a per-tool block with behaviour tags. */
  private renderToolBlock(tool: ResolvedTool): string {
    const lines: string[] = [];

    if (tool.requiresConfirmation) {
      lines.push(`${tool.resolvedName} — CONFIRMATION_FIRST`);
      lines.push(
        'Ask the user for confirmation before executing. Say something like: "I\'d like to {action}. Should I go ahead?"',
      );
    } else {
      lines.push(tool.resolvedName);
    }

    // AC16: useWhen/doNotUseWhen stubs — commented out for future implementation
    // lines.push(`  useWhen: <condition when this tool should be used>`);
    // lines.push(`  doNotUseWhen: <condition when this tool should NOT be used>`);

    return lines.join("\n");
  }
}
