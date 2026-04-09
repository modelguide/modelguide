/**
 * Core compiler types — platform-agnostic, zero framework imports.
 *
 * SOP types imported from modelguide-api (single source of truth).
 * Guardrail types from knowledge-base feature (PR #140).
 */

import type { PromptConfig } from "@db/schema/core";
import type { knowledgeBaseDetailResponseSchema } from "@features/knowledge-base/knowledge-base.schemas";
import type {
  GuardrailCategory,
  GuardrailConfig,
  GuardrailPriority,
} from "@features/knowledge-base/knowledge-base.types";
import type { sopDetailResponseSchema } from "@features/sops/sops.schemas";
import type {
  SopMetadata,
  SopSchema,
  SopStep,
  SopStepTool,
  SopTrigger,
} from "@features/sops/sops.types";
import type { z } from "zod";

// Re-export API types for consumers
export type {
  PromptConfig,
  SopStep,
  SopStepTool,
  SopTrigger,
  SopMetadata,
  SopSchema,
  GuardrailConfig,
  GuardrailCategory,
  GuardrailPriority,
};

// ============================================================================
// Strategy types
// ============================================================================

/** Model families supported by the compiler strategy selector. */
export type ModelFamily = "gpt" | "claude" | "gemini" | "generic";

/** Channel derived from agent modality. */
export type Channel = "voice" | "text";

// ============================================================================
// API response types (inferred from Zod schemas)
// ============================================================================

/** Full KB entry as returned by `GET /api/knowledge-base/:id`. */
export type KnowledgeBaseDetailResponse = z.infer<
  typeof knowledgeBaseDetailResponseSchema
>;

/** Full SOP as returned by `GET /api/sops/:id`. */
export type SopDetailResponse = z.infer<typeof sopDetailResponseSchema>;

// ============================================================================
// Compiler input / output
// ============================================================================

/** Guardrail after parse-time config narrowing. */
export interface ParsedGuardrail {
  id: string;
  name: string;
  /** Short summary — used by voice strategies instead of full content. */
  description: string | null;
  content: string;
  config: GuardrailConfig;
}

/** Minimal SOP info for intent classification. */
export interface AgentSopInfo {
  slug: string;
  name: string;
  description: string | null;
}

/** Input to the compiler pipeline. */
export interface CompilerInput {
  sops: SopDetailResponse[];
  guardrails: KnowledgeBaseDetailResponse[];
  agentConfig: {
    id: string;
    name: string;
    model: string;
    /** Role context, e.g. "You are a customer support agent..." */
    description: string;
    /** Prompt configuration (persona, fillerPhrases, language). */
    promptConfig: PromptConfig;
    /** Model family for strategy selection. */
    modelFamily: ModelFamily;
    /** Channel derived from agent modality. */
    channel: Channel;
  };
  /** All active SOPs assigned to the agent (for intent classification). */
  agentSops?: AgentSopInfo[];
  /** Map of tool resolvedName → requiresConfirmation from agent_connector_tools. */
  toolConfirmationMap?: Record<string, boolean>;
}

/** A tool referenced by at least one SOP step. */
export interface ResolvedTool {
  resolvedName: string;
  connectorToolId?: string;
  connectorId?: string;
  /** Whether the tool requires user confirmation before execution. */
  requiresConfirmation?: boolean;
}

/** SOP step enriched with computed fields from the transform stage. */
export interface EnrichedStep extends SopStep {
  /** "tool" when the source step has a tool reference, "llm" otherwise. */
  type: "tool" | "llm";
  /** Step instruction + matched guardrails assembled into a prompt. */
  scopedPrompt: string;
  /** IDs of guardrails injected into this step's scopedPrompt. */
  matchedGuardrailIds: string[];
}

/** SOP with all steps enriched. */
export interface EnrichedSop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  definition: SopSchema;
  steps: EnrichedStep[];
}

/** Warning emitted by the compiler (e.g. budget overruns). */
export interface CompilerWarning {
  code: string;
  message: string;
  tokens?: number;
}

/** Output metadata — token estimates, cache boundary, warnings. */
export interface CompilerMetadata {
  /** Estimated system prompt tokens (chars / 4). */
  systemPromptTokens: number;
  /** Estimated tool schema tokens (toolCount * 180). */
  estimatedToolSchemaTokens: number;
  /** Sum of system prompt + tool schema tokens. */
  totalEstimatedTokens: number;
  /** Char offset where static content ends (before [Reminders] section). */
  cacheablePrefix: number;
  /** Warnings (e.g. VOICE_BUDGET_EXCEEDED). */
  warnings: CompilerWarning[];
}

/** Intermediate representation — output of core, input to emitters. */
export interface CompilerIR {
  agentConfig: CompilerInput["agentConfig"];
  sop: EnrichedSop;
  systemPrompt: string;
  tools: ResolvedTool[];
  guardrails: ParsedGuardrail[];
  /** Output metadata — token estimates, cache boundary, warnings. */
  metadata: CompilerMetadata;
}
