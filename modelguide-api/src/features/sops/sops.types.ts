/**
 * TypeScript interfaces for SOP JSONB shapes.
 *
 * Storage layout:
 *  - sops:          trigger + metadata as separate JSONB columns; steps in sop_steps table.
 *  - sop_templates: full SopSchema in a single `definition` JSONB (self-contained blueprint).
 *
 * The API always returns an assembled SopSchema regardless of storage layout.
 */

// ============================================================================
// Triggers — discriminated union on `type`
// ============================================================================

export interface ChannelTrigger {
  type: "channel";
  config: { channelTypes: ("voice" | "chat" | "email")[] };
}

export interface IntentDetectedTrigger {
  type: "intent_detected";
  config: { patterns: string[] };
}

export interface ToolPresentTrigger {
  type: "tool_present";
  config: { toolSlugs: string[]; catalogSlug?: string };
}

export interface ManualTrigger {
  type: "manual";
  config: Record<string, never>;
}

export type SopTrigger =
  | ChannelTrigger
  | IntentDetectedTrigger
  | ToolPresentTrigger
  | ManualTrigger;

// ============================================================================
// Steps
// ============================================================================

export interface SopStepTool {
  connectorToolId?: string;
  connectorId?: string;
  catalogSlug?: string;
  toolSlug?: string;
  resolvedName?: string;
}

export interface SopStep {
  id: string;
  order: number;
  instruction: string;
  required: boolean;
  tool?: SopStepTool;
  notes?: string;
}

// ============================================================================
// Metadata
// ============================================================================

export interface SopMetadata {
  reasonCode?: string;
  tags?: string[];
  estimatedDuration?: string;
  escalationTriggers?: string[];
}

// ============================================================================
// Top-level SOP definition (stored as JSONB)
// ============================================================================

export interface SopSchema {
  schemaVersion: 1;
  trigger: SopTrigger;
  steps: SopStep[];
  metadata: SopMetadata;
}
