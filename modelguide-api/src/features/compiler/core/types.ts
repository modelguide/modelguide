/**
 * Core compiler types — platform-agnostic, zero framework imports.
 *
 * SOP types imported from modelguide-api (single source of truth).
 * Guardrail types from knowledge-base feature (PR #140).
 */

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
  };
  /** All active SOPs assigned to the agent (for intent classification). */
  agentSops?: AgentSopInfo[];
}

/** A tool referenced by at least one SOP step. */
export interface ResolvedTool {
  resolvedName: string;
  connectorToolId?: string;
  connectorId?: string;
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

/** Intermediate representation — output of core, input to emitters. */
export interface CompilerIR {
  agentConfig: CompilerInput["agentConfig"];
  sop: EnrichedSop;
  systemPrompt: string;
  tools: ResolvedTool[];
  guardrails: ParsedGuardrail[];
}
