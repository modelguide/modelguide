/**
 * Dimension derivation and tuple selection for test case generation.
 *
 * - deriveDimensionsFromSop() — LLM-derived dimensions via generateObject()
 * - selectTuples() — stratified sampling (no LLM)
 * - toneToPersonaId() — maps tones to existing persona IDs
 */

import { env } from "@/env";
import type { SopStep } from "@features/sops/sops.types";
import { generateObject } from "ai";
import { z } from "zod";
import { resolveGenerationModel } from "./model";
import { parseFields } from "./parse-fields";
import type {
  DimensionConfig,
  DimensionTuple,
  TokenUsage,
  ToolStateVariant,
} from "./types";
import { COMPLEXITIES, TONES } from "./types";

// ============================================================================
// Zod schema for LLM-derived dimensions
// ============================================================================

/**
 * Tool state variant schema for LLM output.
 *
 * z.record() produces `additionalProperties` in JSON Schema which some
 * providers reject. We use an array of { key, value } pairs instead
 * and convert to a Record after generation.
 */
const toolStateFieldSchema = z.object({
  key: z.string().describe("Field name (e.g. 'status', 'error', 'tracking')"),
  value: z
    .string()
    .describe(
      "Field value as a string. Use 'true'/'false' for booleans, stringified numbers for numbers.",
    ),
});

const toolVariantSchema = z.object({
  fields: z
    .array(toolStateFieldSchema)
    .describe("Key-value pairs representing one mock tool response"),
});

const toolStatesEntrySchema = z.object({
  toolSlug: z.string().describe("Exact tool slug from the SOP"),
  variants: z
    .array(toolVariantSchema)
    .describe(
      "3-4 response variants for this tool, including one error state with fields: key='error' value='true', key='message' value='<error description>'",
    ),
});

const dimensionConfigSchema = z.object({
  intents: z
    .array(z.string())
    .min(1)
    .describe(
      "Customer intents relevant to this SOP (generate exactly 3-6 items)",
    ),
  edgeCases: z
    .array(z.string())
    .min(1)
    .describe(
      'Edge cases including "straightforward" as the first item (generate exactly 5-8 items)',
    ),
  toolStates: z
    .array(toolStatesEntrySchema)
    .describe(
      "Mock tool response variants per tool slug. Empty array if SOP has no tool steps.",
    ),
});

// ============================================================================
// Persona mapping
// ============================================================================

const TONE_PERSONA_MAP: Record<string, string> = {
  frustrated: "impatient-returner",
  hostile: "impatient-returner",
  confused: "confused-browser",
  polite: "polite-buyer",
  terse: "polite-buyer",
};

/** Map a dimension tone to an existing persona ID. */
export function toneToPersonaId(tone: string): string {
  return TONE_PERSONA_MAP[tone] ?? "polite-buyer";
}

// ============================================================================
// deriveDimensionsFromSop
// ============================================================================

/** Extract tool slugs from SOP steps that reference connector tools. */
function extractToolSlugs(steps: SopStep[]): string[] {
  const slugs: string[] = [];
  for (const step of steps) {
    if (step.tool?.resolvedName) {
      slugs.push(step.tool.resolvedName);
    }
  }
  return [...new Set(slugs)];
}

/**
 * Derive scenario dimensions from a SOP using generateObject()
 * (model configurable via GENERATION_DIMENSION_MODEL).
 *
 * Returns intents, fixed tones/complexity, LLM-derived edge cases,
 * and tool-state variants per tool slug.
 */
export async function deriveDimensionsFromSop(
  sopName: string,
  sopDescription: string | null,
  steps: SopStep[],
): Promise<{ dimensions: DimensionConfig; usage: TokenUsage }> {
  const toolSlugs = extractToolSlugs(steps);

  const stepsDescription = steps
    .map((s, i) => {
      const toolInfo = s.tool?.resolvedName
        ? ` [tool: ${s.tool.resolvedName}]`
        : "";
      return `${i + 1}. ${s.instruction}${toolInfo}${s.required ? " (required)" : " (optional)"}`;
    })
    .join("\n");

  const toolSlugsInfo =
    toolSlugs.length > 0
      ? `\nTool slugs in this SOP: ${toolSlugs.join(", ")}\nGenerate 3-4 mock response variants per tool (including one error state). Each variant is an array of { key, value } pairs representing the mock response fields.`
      : "\nThis SOP has no tool-referencing steps. Return an empty array for toolStates.";

  const prompt = `Analyze this Standard Operating Procedure (SOP) and derive test scenario dimensions.

SOP Name: ${sopName}
${sopDescription ? `Description: ${sopDescription}` : ""}

Steps:
${stepsDescription}
${toolSlugsInfo}

Generate:
1. "intents" — 3-6 customer intents that would trigger this SOP (e.g., "order_status", "delivery_delay")
2. "edgeCases" — 5-8 edge cases starting with "straightforward", then increasingly challenging scenarios (e.g., "ambiguous_intent", "missing_order_number", "contradictory_request")
3. "toolStates" — array of { toolSlug, variants } entries. Each variant has a "fields" array of { key, value } pairs. Include one error variant per tool with key="error" value="true".

Make intents specific to this SOP's domain. Make edge cases relevant to the SOP's workflow.
Tool slugs must match the exact slugs listed above.`;

  const { object, usage } = await generateObject({
    model: resolveGenerationModel(env.GENERATION_DIMENSION_MODEL),
    schema: dimensionConfigSchema,
    prompt,
  });

  // Convert LLM array-of-entries format to Record<slug, ToolStateVariant[]>
  const toolStatesRecord: Record<string, ToolStateVariant[]> = {};
  if (toolSlugs.length > 0) {
    for (const entry of object.toolStates) {
      toolStatesRecord[entry.toolSlug] = entry.variants.map((v) =>
        parseFields(v.fields),
      );
    }
  }

  // Merge LLM-derived fields with fixed dimensions
  const dimensions: DimensionConfig = {
    intents: object.intents,
    tones: [...TONES],
    complexity: [...COMPLEXITIES],
    edgeCases: object.edgeCases,
    toolStates: toolStatesRecord,
  };

  return {
    dimensions,
    usage: {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
    },
  };
}

// ============================================================================
// selectTuples
// ============================================================================

interface SelectTuplesOpts {
  count: number;
}

/** Create a hash key for deduplication (sorted keys for order independence). */
function tupleKey(t: DimensionTuple): string {
  const sortedState = JSON.stringify(
    t.toolState,
    Object.keys(t.toolState).sort(),
  );
  return `${t.intent}|${t.tone}|${t.complexity}|${t.edgeCase}|${sortedState}`;
}

/** Pick a random element from an array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Build a toolState record by picking one variant per tool slug. */
function pickToolState(
  toolStates: Record<string, ToolStateVariant[]>,
  specificSlug?: string,
  specificIdx?: number,
): Record<string, ToolStateVariant> {
  const result: Record<string, ToolStateVariant> = {};
  for (const [slug, variants] of Object.entries(toolStates)) {
    if (slug === specificSlug && specificIdx !== undefined) {
      result[slug] = variants[specificIdx % variants.length];
    } else {
      result[slug] = pick(variants);
    }
  }
  return result;
}

/**
 * Select deduplicated dimension tuples using stratified sampling.
 *
 * Strategy:
 * 1. Happy path: intent x tool state (systematic coverage)
 * 2. Edge case: edge case x intent (each edge paired with each intent)
 * 3. Stress: hard tone + high complexity + edge case
 *
 * No LLM calls — pure in-process code (uses Math.random for variety).
 */
export function selectTuples(
  dims: DimensionConfig,
  opts: SelectTuplesOpts,
): DimensionTuple[] {
  const seen = new Set<string>();
  const tuples: DimensionTuple[] = [];

  function addIfNew(t: DimensionTuple): boolean {
    const key = tupleKey(t);
    if (seen.has(key)) return false;
    if (tuples.length >= opts.count) return false;
    seen.add(key);
    tuples.push(t);
    return true;
  }

  const toolSlugs = Object.keys(dims.toolStates);

  // --- Layer 1: Happy path coverage (intent x tool state) ---
  for (const intent of dims.intents) {
    if (toolSlugs.length > 0) {
      for (const slug of toolSlugs) {
        const variants = dims.toolStates[slug];
        for (let vi = 0; vi < variants.length; vi++) {
          addIfNew({
            intent,
            tone: pick(["polite", "terse"]),
            complexity: pick(["single_step", "multi_step"]),
            edgeCase: "straightforward",
            toolState: pickToolState(dims.toolStates, slug, vi),
          });
        }
      }
    } else {
      // No tools — still generate happy path tuples
      addIfNew({
        intent,
        tone: pick(["polite", "terse"]),
        complexity: pick(["single_step", "multi_step"]),
        edgeCase: "straightforward",
        toolState: {},
      });
    }
  }

  // --- Layer 2: Edge case coverage (edge case x intent) ---
  const nonStraightforward = dims.edgeCases.filter(
    (e) => e !== "straightforward",
  );
  for (const edgeCase of nonStraightforward) {
    for (const intent of dims.intents) {
      addIfNew({
        intent,
        tone: pick(dims.tones),
        complexity: pick(dims.complexity),
        edgeCase,
        toolState: pickToolState(dims.toolStates),
      });
    }
  }

  // --- Layer 3: Stress combinations (hard tone + high complexity + edge) ---
  const hardTones = ["frustrated", "hostile"];
  for (const tone of hardTones) {
    for (const edgeCase of nonStraightforward) {
      addIfNew({
        intent: pick(dims.intents),
        tone,
        complexity: "requires_escalation",
        edgeCase,
        toolState: pickToolState(dims.toolStates),
      });
    }
  }

  // --- Fill remaining with random combinations ---
  let attempts = 0;
  const maxAttempts = opts.count * 3;
  while (tuples.length < opts.count && attempts < maxAttempts) {
    attempts++;
    addIfNew({
      intent: pick(dims.intents),
      tone: pick(dims.tones),
      complexity: pick(dims.complexity),
      edgeCase: pick(dims.edgeCases),
      toolState: pickToolState(dims.toolStates),
    });
  }

  return tuples;
}
