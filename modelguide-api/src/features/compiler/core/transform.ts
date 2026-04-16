/**
 * Transform stage — enriches SOP steps with type, scoped prompts,
 * and matched guardrail IDs.
 *
 * Input: parsed SOP + guardrails from the parse stage.
 * Output: TransformResult — structured data for strategies to build prompts from.
 */

import type { SopStep } from "@features/sops/sops.types";
import { matchGuardrails } from "./guardrail-matcher";
import { buildScopedPrompt } from "./prompt-builder";
import type {
  CompilerInput,
  EnrichedSop,
  EnrichedStep,
  ParsedGuardrail,
  ResolvedTool,
  SopDetailResponse,
  TransformResult,
} from "./types";

// ============================================================================
// Step enrichment
// ============================================================================

/** Derive step type: "tool" when the source step has a tool reference, "llm" otherwise. */
function deriveStepType(step: SopStep): "tool" | "llm" {
  return step.tool?.resolvedName ? "tool" : "llm";
}

/**
 * Normalize a Zod-inferred step to the SopStep interface.
 * Zod schemas produce `string | null | undefined` for nullable optional fields,
 * while the hand-written SopStep interface uses `string | undefined`.
 */
function normalizeStep(
  step: SopDetailResponse["definition"]["steps"][number],
): SopStep {
  return {
    id: step.id,
    order: step.order,
    instruction: step.instruction,
    required: step.required,
    tool: step.tool ?? undefined,
    evalConfigId: step.evalConfigId ?? undefined,
    notes: step.notes ?? undefined,
  };
}

/** Enrich a single SOP step with computed fields. */
function enrichStep(
  step: SopStep,
  guardrails: ParsedGuardrail[],
): EnrichedStep {
  const type = deriveStepType(step);
  const matched = matchGuardrails(step, guardrails);
  const scopedPrompt = buildScopedPrompt(step, matched);
  const matchedGuardrailIds = matched.map((g) => g.id);

  return {
    ...step,
    type,
    scopedPrompt,
    matchedGuardrailIds,
  };
}

// ============================================================================
// Transform
// ============================================================================

/**
 * Enrich a single SOP into an EnrichedSop.
 */
function enrichSop(
  sop: SopDetailResponse,
  guardrails: ParsedGuardrail[],
): EnrichedSop {
  const normalizedSteps = sop.definition.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(normalizeStep);

  const enrichedSteps = normalizedSteps.map((step) =>
    enrichStep(step, guardrails),
  );

  const normalizedDefinition = {
    ...sop.definition,
    steps: normalizedSteps,
  };

  return {
    id: sop.id,
    name: sop.name,
    slug: sop.slug,
    description: sop.description,
    definition: normalizedDefinition,
    steps: enrichedSteps,
  };
}

/**
 * Transform parsed SOPs + guardrails into a TransformResult.
 */
export function transform(
  sops: SopDetailResponse[],
  tools: ResolvedTool[],
  guardrails: ParsedGuardrail[],
  agentConfig: CompilerInput["agentConfig"],
): TransformResult {
  const enrichedSops = sops.map((sop) => enrichSop(sop, guardrails));

  return {
    agentConfig,
    sops: enrichedSops,
    tools,
    guardrails,
  };
}
