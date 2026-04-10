/**
 * Unit tests for prompt strategies — getStrategy(), GptVoiceStrategy, GenericStrategy.
 */

import { describe, expect, it } from "bun:test";
import { compile } from "@features/compiler/core/compile";
import {
  GenericStrategy,
  GptVoiceStrategy,
  getStrategy,
} from "@features/compiler/core/prompt-strategies";
import type {
  CompilerInput,
  KnowledgeBaseDetailResponse,
  SopDetailResponse,
} from "@features/compiler/core/types";

// ============================================================================
// Shared fixtures
// ============================================================================

function makeAgentConfig(
  overrides: Partial<CompilerInput["agentConfig"]> = {},
) {
  return {
    id: "test-agent",
    name: "Test Agent",
    model: "openai:gpt-4.1-mini",
    description: "a pre-screening voice agent for candidate recruitment",
    promptConfig: {},
    modelFamily: "generic" as const,
    modality: "text" as const,
    ...overrides,
  };
}

const voiceAgentConfig = makeAgentConfig({
  modelFamily: "gpt",
  modality: "voice",
  promptConfig: {
    persona:
      "Warm, efficient, respectful recruiter. You DRIVE the conversation.",
    fillerPhrases: ["One sec.", "Checking now.", "Bear with me."],
  },
});

const makeSop = (
  overrides?: Partial<SopDetailResponse>,
): SopDetailResponse => ({
  id: "sop-001",
  name: "Booking Pre-Screen",
  slug: "booking-pre-screen",
  description: "Pre-screening voice SOP",
  status: "active",
  version: "1.0",
  assignedAgents: [],
  sopTemplateId: null,
  template: null,
  definition: {
    schemaVersion: 1,
    trigger: { type: "manual", config: {} },
    steps: [
      {
        id: "introduction",
        order: 1,
        instruction:
          'Greet the candidate and set expectations: "I will ask a few questions about your background."',
        required: true,
        tool: {
          connectorToolId: "a0000000-0000-0000-0000-000000000001",
          connectorId: "a0000000-0000-0000-0000-000000000010",
          resolvedName: "crm_lookup_candidate",
        },
      },
      {
        id: "background",
        order: 2,
        instruction:
          'Ask: "Could you tell me about yourself and what drew you to this position?"',
        required: true,
      },
      {
        id: "closing",
        order: 3,
        instruction:
          'Say: "Based on what you shared, this sounds like it could be a great fit."',
        required: true,
      },
    ],
    metadata: {
      escalationTriggers: ["If the candidate becomes abusive, end the call."],
    },
  },
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
  ...overrides,
});

const makeGuardrails = (
  overrides?: Partial<KnowledgeBaseDetailResponse>[],
): KnowledgeBaseDetailResponse[] => {
  const defaults: KnowledgeBaseDetailResponse[] = [
    {
      id: "g1",
      type: "guardrail",
      name: "No salary info",
      slug: "no-salary-info",
      content:
        "Compensation details are not available. If the candidate asks about salary, say: the recruiter will share the full compensation details in the next step. Do not invent, estimate, or state any figure.",
      description: "Never share salary information",
      config: {
        priority: "critical",
        critical: true,
        reason: "Legal liability",
      },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
    },
    {
      id: "g2",
      type: "guardrail",
      name: "Be polite",
      slug: "be-polite",
      content:
        "Always maintain a warm and professional tone. Use the candidate's name, avoid jargon, and keep responses concise.",
      description: "Stay warm and professional",
      config: { priority: "medium" },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
    },
  ];
  if (overrides) {
    return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
  }
  return defaults;
};

function makeCompilerInput(overrides?: Partial<CompilerInput>): CompilerInput {
  return {
    sops: [makeSop()],
    guardrails: makeGuardrails(),
    agentConfig: voiceAgentConfig,
    ...overrides,
  };
}

function compileVoice(overrides?: Partial<CompilerInput>) {
  return compile(makeCompilerInput(overrides));
}

// ============================================================================
// getStrategy() selection tests
// ============================================================================

describe("getStrategy()", () => {
  it("returns GptVoiceStrategy for (gpt, voice)", () => {
    const strategy = getStrategy("gpt", "voice");
    expect(strategy).toBeInstanceOf(GptVoiceStrategy);
    expect(strategy.name).toBe("GptVoiceStrategy");
  });

  it("returns GenericStrategy for (gpt, text)", () => {
    const strategy = getStrategy("gpt", "text");
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });

  it("returns GenericStrategy for (claude, voice)", () => {
    const strategy = getStrategy("claude", "voice");
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });

  it("returns GenericStrategy for (claude, text)", () => {
    const strategy = getStrategy("claude", "text");
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });

  it("returns GenericStrategy for (gemini, voice)", () => {
    const strategy = getStrategy("gemini", "voice");
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });

  it("returns GenericStrategy for (generic, text)", () => {
    const strategy = getStrategy("generic", "text");
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });

  it("returns GenericStrategy for (generic, voice)", () => {
    const strategy = getStrategy("generic", "voice");
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });
});

// ============================================================================
// GptVoiceStrategy output format tests
// ============================================================================

describe("GptVoiceStrategy", () => {
  const ir = compileVoice();
  const prompt = ir.systemPrompt;

  it("renders all guardrails uniformly in normal case", () => {
    expect(prompt).toContain(
      "Compensation details are not available. If the candidate asks about salary, say: the recruiter will share the full compensation details in the next step. Do not invent, estimate, or state any figure.",
    );
    expect(prompt).toContain("Always maintain a warm and professional tone.");
    // No ALL CAPS — all guardrails rendered uniformly
    expect(prompt).not.toContain("COMPENSATION DETAILS ARE NOT AVAILABLE");
    expect(prompt).not.toContain(
      "ALWAYS MAINTAIN A WARM AND PROFESSIONAL TONE",
    );
  });

  it("AC10: includes vocal normalization block", () => {
    expect(prompt).toContain("# Reference Pronunciations");
    expect(prompt).toContain('"one hundred dollars"');
    expect(prompt).toContain('"ten thirty A M"');
    expect(prompt).toContain('"second" not "2nd"');
  });

  it("AC11: includes response length rule (2-3 sentences)", () => {
    expect(prompt).toContain("2-3 sentences per turn");
  });

  it("AC12: includes variety rule", () => {
    expect(prompt).toContain(
      "Do not repeat the same sentence twice. Vary your responses.",
    );
  });

  it("AC13: includes no-markdown instruction", () => {
    expect(prompt).toContain("Do not use markdown, bullet points, lists");
    expect(prompt).toContain("meant to be read aloud");
  });

  it("AC14: includes context reliance instruction", () => {
    expect(prompt).toContain("Use only the information provided");
    expect(prompt).toContain("do not supplement with general knowledge");
  });

  it("AC3: description first, persona second", () => {
    const descIdx = prompt.indexOf("# Role & Objective");
    const personaIdx = prompt.indexOf("# Personality & Tone");
    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(personaIdx).toBeGreaterThan(descIdx);
    expect(prompt).toContain(
      "You are a pre-screening voice agent for candidate recruitment.",
    );
    expect(prompt).toContain(
      "Warm, efficient, respectful recruiter. You DRIVE the conversation.",
    );
  });

  it("AC15: SOP steps in state blocks with labels and transitions", () => {
    expect(prompt).toContain("## Step 1: introduction");
    expect(prompt).toContain("## Step 2: background");
    expect(prompt).toContain("## Step 3: closing");
    // GOAL derived from step id (humanized)
    expect(prompt).toContain("GOAL: Introduction");
    expect(prompt).toContain("GOAL: Background");
    expect(prompt).toContain("GOAL: Closing");
    // EXIT prefix on transitions
    expect(prompt).toContain("EXIT → Step 2");
    expect(prompt).toContain("EXIT → Step 3");
    expect(prompt).toContain("EXIT → End");
  });

  it("AC15: step instructions are preserved verbatim", () => {
    expect(prompt).toContain(
      'Greet the candidate and set expectations: "I will ask a few questions about your background."',
    );
    expect(prompt).toContain(
      '"Could you tell me about yourself and what drew you to this position?"',
    );
    expect(prompt).toContain(
      '"Based on what you shared, this sounds like it could be a great fit."',
    );
  });

  it("rewrites symbolic operators to plain English in step instructions", () => {
    const symbolicSop = makeSop({
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "check-wait-time",
            order: 1,
            instruction:
              'If hold time > 240 seconds, apologize. If attempts >= 3, escalate. If account == null, ask for details. If status != "active", flag the case.',
            required: true,
          },
        ],
        metadata: {},
      },
    });
    const ir = compileVoice({ sops: [symbolicSop] });
    const p = ir.systemPrompt;
    expect(p).toContain("more than 240");
    expect(p).toContain("at least 3");
    expect(p).toContain("does not exist");
    expect(p).toContain('is not "active"');
    expect(p).not.toContain("> 240");
    expect(p).not.toContain(">= 3");
    expect(p).not.toContain("== null");
    expect(p).not.toContain('!= "active"');
  });

  it("AC16: filler preamble uses promptConfig.fillerPhrases", () => {
    expect(prompt).toContain('"One sec."');
    expect(prompt).toContain('"Checking now."');
    expect(prompt).toContain('"Bear with me."');
    expect(prompt).toContain("Never use the same filler twice in a row");
  });

  it("AC16: falls back to default filler phrases when none configured", () => {
    const noFillerIr = compileVoice({
      agentConfig: makeAgentConfig({
        modelFamily: "gpt",
        modality: "voice",
        promptConfig: { persona: "Test persona." },
      }),
    });
    const p = noFillerIr.systemPrompt;
    expect(p).toContain('"One moment."');
    expect(p).toContain('"Let me check."');
    expect(p).toContain('"Just a second."');
  });

  it("AC17: includes tool hallucination guard", () => {
    expect(prompt).toContain(
      "If you don't have enough information to call a tool, ask the user before calling it.",
    );
  });

  it("AC18: all guardrail names appear in both Rules and Reminders (sandwich)", () => {
    const rulesIdx = prompt.indexOf("# Rules");
    const remindersIdx = prompt.indexOf("# Reminders");
    expect(rulesIdx).toBeGreaterThan(0);
    expect(remindersIdx).toBeGreaterThan(rulesIdx);

    // Guardrail headings appear in both sections
    const rulesSection = prompt.slice(rulesIdx, remindersIdx);
    const remindersSection = prompt.slice(remindersIdx);
    expect(rulesSection).toContain("## No salary info");
    expect(remindersSection).toContain("## No salary info");
    expect(rulesSection).toContain("## Be polite");
    expect(remindersSection).toContain("## Be polite");
  });

  it("AC19: no agentic boilerplate (persistence/tool-calling/planning)", () => {
    expect(prompt).not.toContain("persistence");
    expect(prompt).not.toContain("When you encounter a problem");
    expect(prompt).not.toContain("When you are unsure");
    expect(prompt).not.toContain("planning");
    // tool-calling as an instruction, not the word in context
    expect(prompt).not.toMatch(/always attempt to use.*tool/i);
  });

  it("AC20: safety & escalation in static prefix", () => {
    const safetyIdx = prompt.indexOf("# Safety & Escalation");
    const remindersIdx = prompt.indexOf("# Reminders");
    expect(safetyIdx).toBeGreaterThan(0);
    // Safety is before Reminders (in static prefix)
    expect(safetyIdx).toBeLessThan(remindersIdx);
    expect(prompt).toContain("If the candidate becomes abusive, end the call.");
  });

  it("AC6: CONFIRMATION_FIRST tag for tools with requiresConfirmation", () => {
    const confirmedIr = compileVoice({
      toolConfirmationMap: { crm_lookup_candidate: true },
    });
    const p = confirmedIr.systemPrompt;
    expect(p).toContain("crm_lookup_candidate — CONFIRMATION_FIRST");
    expect(p).toContain("Ask the user for confirmation before executing");
  });

  it("cache boundary lands exactly at the Reminders section break", () => {
    const prefix = ir.metadata.cacheablePrefix;
    expect(prefix).toBeGreaterThan(0);
    // The content after cacheablePrefix must start with the Reminders section
    const tail = prompt.slice(prefix);
    expect(tail.trimStart().startsWith("# Reminders")).toBe(true);
    // Everything before cacheablePrefix must NOT contain Reminders
    expect(prompt.slice(0, prefix)).not.toContain("# Reminders");
  });

  it("cacheablePrefix equals prompt length when no guardrails", () => {
    const noGuardrailsIr = compileVoice({ guardrails: [] });
    // No guardrails → no Reminders section → entire prompt is cacheable
    expect(noGuardrailsIr.metadata.cacheablePrefix).toBe(
      noGuardrailsIr.systemPrompt.length,
    );
    expect(noGuardrailsIr.systemPrompt).not.toContain("# Reminders");
    expect(noGuardrailsIr.systemPrompt).not.toContain("# Rules");
  });

  it("sandwich technique: Rules has full content, Reminders has concise description", () => {
    // Split prompt at the two sections
    const rulesIdx = prompt.indexOf("# Rules");
    const remindersIdx = prompt.indexOf("# Reminders");
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(remindersIdx).toBeGreaterThan(rulesIdx);

    const rulesSection = prompt.slice(rulesIdx, remindersIdx);
    const remindersSection = prompt.slice(remindersIdx);

    // Rules should contain the full content
    expect(rulesSection).toContain("Compensation details are not available");
    expect(rulesSection).toContain(
      "Do not invent, estimate, or state any figure",
    );
    expect(rulesSection).toContain(
      "Always maintain a warm and professional tone. Use the candidate",
    );

    // Reminders should contain the concise descriptions, NOT the full content
    expect(remindersSection).toContain("Never share salary information");
    expect(remindersSection).toContain("Stay warm and professional");
    expect(remindersSection).not.toContain(
      "Do not invent, estimate, or state any figure",
    );
    expect(remindersSection).not.toContain("Use the candidate");
  });
});

// ============================================================================
// GenericStrategy backward compatibility
// ============================================================================

describe("GenericStrategy backward compatibility (AC21)", () => {
  it("produces markdown format with ## headers", () => {
    const genericIr = compile({
      sops: [makeSop()],
      guardrails: makeGuardrails(),
      agentConfig: makeAgentConfig({
        modelFamily: "generic",
        modality: "text",
      }),
    });
    const prompt = genericIr.systemPrompt;

    // Should use markdown headers
    expect(prompt).toContain("## Workflow:");
    expect(prompt).toContain("## Tools");
    expect(prompt).toContain("## Guardrails");
  });

  it("does NOT include voice-specific sections", () => {
    const genericIr = compile({
      sops: [makeSop()],
      guardrails: makeGuardrails(),
      agentConfig: makeAgentConfig({
        modelFamily: "generic",
        modality: "text",
      }),
    });
    const prompt = genericIr.systemPrompt;

    expect(prompt).not.toContain("# Reference Pronunciations");
    expect(prompt).not.toContain("# Personality & Tone");
    expect(prompt).not.toContain("# Reminders");
  });

  it("cacheablePrefix equals prompt length (no reminders section)", () => {
    const genericIr = compile({
      sops: [makeSop()],
      guardrails: makeGuardrails(),
      agentConfig: makeAgentConfig({
        modelFamily: "generic",
        modality: "text",
      }),
    });
    expect(genericIr.metadata.cacheablePrefix).toBe(
      genericIr.systemPrompt.length,
    );
  });
});

// ============================================================================
// Output metadata — token estimates and warnings
// ============================================================================

describe("Output metadata (AC22, AC23)", () => {
  it("AC22: computes systemPromptTokens as chars/4", () => {
    const ir = compileVoice();
    const expectedTokens = Math.ceil(ir.systemPrompt.length / 4);
    expect(ir.metadata.systemPromptTokens).toBe(expectedTokens);
  });

  it("AC22: computes estimatedToolSchemaTokens as toolCount * 180", () => {
    const ir = compileVoice();
    expect(ir.metadata.estimatedToolSchemaTokens).toBe(ir.tools.length * 180);
  });

  it("AC22: totalEstimatedTokens is sum of system + tool", () => {
    const ir = compileVoice();
    expect(ir.metadata.totalEstimatedTokens).toBe(
      ir.metadata.systemPromptTokens + ir.metadata.estimatedToolSchemaTokens,
    );
  });

  it("AC22: cacheablePrefix is a positive number", () => {
    const ir = compileVoice();
    expect(ir.metadata.cacheablePrefix).toBeGreaterThan(0);
  });

  it("AC23: warns when voice budget exceeded", () => {
    // Build a SOP with many steps to exceed 2,500 token budget (instruction max is 2000)
    const longInstruction = "A".repeat(1900);
    const steps = Array.from({ length: 8 }, (_, i) => ({
      id: `long-step-${i}`,
      order: i + 1,
      instruction: longInstruction,
      required: true,
      tool: {
        connectorToolId: "00000000-0000-0000-0000-000000000001",
        connectorId: "00000000-0000-0000-0000-000000000010",
        resolvedName: "crm_lookup_candidate",
      },
    }));
    const ir = compileVoice({
      sops: [
        makeSop({
          definition: {
            schemaVersion: 1,
            trigger: { type: "manual", config: {} },
            steps,
            metadata: {},
          },
        }),
      ],
    });

    expect(ir.metadata.totalEstimatedTokens).toBeGreaterThan(2500);
    expect(ir.metadata.warnings.length).toBeGreaterThan(0);
    expect(ir.metadata.warnings[0].code).toBe("VOICE_BUDGET_EXCEEDED");
  });

  it("AC23: warns when text budget exceeded", () => {
    const longInstruction = "A".repeat(1900);
    const steps = Array.from({ length: 20 }, (_, i) => ({
      id: `long-step-${i}`,
      order: i + 1,
      instruction: longInstruction,
      required: true,
      tool: {
        connectorToolId: "00000000-0000-0000-0000-000000000001",
        connectorId: "00000000-0000-0000-0000-000000000010",
        resolvedName: "crm_lookup_candidate",
      },
    }));
    const ir = compile({
      sops: [
        makeSop({
          definition: {
            schemaVersion: 1,
            trigger: { type: "manual", config: {} },
            steps,
            metadata: {},
          },
        }),
      ],
      guardrails: [],
      agentConfig: makeAgentConfig({
        modelFamily: "generic",
        modality: "text",
      }),
    });

    expect(ir.metadata.totalEstimatedTokens).toBeGreaterThan(8000);
    expect(ir.metadata.warnings.length).toBeGreaterThan(0);
    expect(ir.metadata.warnings[0].code).toBe("TEXT_BUDGET_EXCEEDED");
  });

  it("AC23: no warning when under budget", () => {
    const ir = compileVoice();
    // Fixture must stay under budget for this test to be meaningful
    expect(ir.metadata.totalEstimatedTokens).toBeLessThanOrEqual(2500);
    expect(ir.metadata.warnings).toEqual([]);
  });

  it("warns when a tool block exceeds per-tool token limit", () => {
    const verboseSop = makeSop({
      definition: {
        schemaVersion: 1,
        trigger: { type: "manual", config: {} },
        steps: [
          {
            id: "step-with-tool",
            order: 1,
            instruction: "Use the tool.",
            required: true,
            tool: {
              connectorToolId: "00000000-0000-0000-0000-000000000001",
              connectorId: "00000000-0000-0000-0000-000000000010",
              resolvedName:
                "glowbox_store_extremely_verbose_tool_with_a_really_absurdly_long_name_that_eats_way_too_many_precious_voice_tokens_from_budget",
            },
          },
        ],
        metadata: {},
      },
    });
    // Mark the tool as requires_confirmation to inflate the block further
    const ir = compileVoice({
      sops: [verboseSop],
      toolConfirmationMap: {
        glowbox_store_extremely_verbose_tool_with_a_really_absurdly_long_name_that_eats_way_too_many_precious_voice_tokens_from_budget: true,
      },
    });
    const toolWarning = ir.metadata.warnings.find(
      (w) => w.code === "TOOL_BLOCK_OVER_BUDGET",
    );
    expect(toolWarning).toBeDefined();
    expect(toolWarning!.message).toContain(
      "glowbox_store_extremely_verbose_tool",
    );
  });
});
