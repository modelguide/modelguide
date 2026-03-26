/**
 * Types for the synthetic test case generation pipeline.
 *
 * Covers: dimension derivation, tuple selection, case generation,
 * validation, and run result aggregation.
 */

// ============================================================================
// Dimension types (Step 1 — derived from SOP via Sonnet)
// ============================================================================

/** JSON leaf value — string, number, boolean, or null. */
export type JsonLeaf = string | number | boolean | null;

/** Tool state variant — a mock response shape for a specific tool. */
export type ToolStateVariant = Record<string, JsonLeaf>;

/**
 * Dimensions derived from a SOP for test case generation.
 * Intents and toolStates are LLM-derived; tones and complexity are fixed.
 */
export interface DimensionConfig {
  /** Customer intents relevant to this SOP (3-6). */
  intents: string[];
  /** Fixed tone set. */
  tones: string[];
  /** Fixed complexity levels. */
  complexity: string[];
  /** Edge cases including "straightforward" (5-8). */
  edgeCases: string[];
  /** Mock tool response variants per tool slug (3-4 per tool, incl. error). */
  toolStates: Record<string, ToolStateVariant[]>;
}

// ============================================================================
// Tuple types (Step 2 — stratified sampling, no LLM)
// ============================================================================

/** A single combination of dimensions for one test case. */
export interface DimensionTuple {
  intent: string;
  tone: string;
  complexity: string;
  edgeCase: string;
  /** Tool slug -> mock response for this tuple. Empty object if no tools. */
  toolState: Record<string, ToolStateVariant>;
}

// ============================================================================
// Generated test case (Step 3 — LLM-generated via Haiku)
// ============================================================================

/** Raw output from the LLM for a single test case. */
export interface GeneratedTestCase {
  name: string;
  scenario: string;
  input_email: string;
  mock_tool_responses: Record<string, ToolStateVariant>;
}

// ============================================================================
// Validation (Step 4)
// ============================================================================

/** Result of structural + semantic validation for one case. */
export interface ValidationResult {
  valid: boolean;
  issues: string[];
  source: "structural" | "semantic" | null;
}

/** A rejected case with reason tracking. */
export interface GenerationRejection {
  tupleName: string;
  issues: string[];
  rejectionSource: "structural" | "semantic";
}

// ============================================================================
// Run result (Step 5 — returned from the pipeline)
// ============================================================================

/** Token usage breakdown for a single LLM stage. */
export interface TokenUsage {
  input: number;
  output: number;
}

/** Cost breakdown across all LLM stages. */
export interface GenerationCost {
  dimensionTokens: TokenUsage;
  generationTokens: TokenUsage;
  validationTokens: TokenUsage;
  estimatedCostUsd: number;
}

/** Top issue with frequency count. */
export interface TopIssue {
  issue: string;
  count: number;
}

/** Full result of a generation run. */
export interface GenerationRunResult {
  accepted: number;
  rejected: number;
  rejections: GenerationRejection[];
  rejectionsBySource: { structural: number; semantic: number };
  topIssues: TopIssue[];
  cost: GenerationCost;
}

// ============================================================================
// Progress tracking (for task runner)
// ============================================================================

/** Progress state for polling. */
export interface GenerationProgress {
  status: "deriving_dimensions" | "generating" | "completed" | "failed";
  completed: number;
  total: number;
  accepted: number;
  rejected: number;
  error?: string;
  result?: GenerationRunResult;
}
