/**
 * TypeScript interfaces for SOP JSONB shapes.
 * These define the structure stored in the `definition` column.
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
  toolSlug: string;
  connectorId?: string;
  catalogSlug?: string;
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
