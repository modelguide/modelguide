/**
 * TypeScript interfaces for knowledge base config shapes.
 * Each KB type has its own config interface (discriminated by `type`).
 */

export type GuardrailCategory =
  | "safety"
  | "compliance"
  | "brand"
  | "operational";

export type GuardrailPriority = "critical" | "high" | "medium" | "low";

export interface GuardrailConfig {
  category?: GuardrailCategory;
  priority: GuardrailPriority;
  /** Why this guardrail exists — used by strategy renderers. */
  reason?: string;
  /** When true, guardrail is emitted at both top and bottom of compiled prompt. */
  critical?: boolean;
}

/** Union of all KB config types (currently just guardrails). */
export type KnowledgeBaseConfig = GuardrailConfig;
