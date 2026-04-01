/**
 * Dimension derivation and tuple selection for test case generation.
 *
 * - deriveDimensionsFromSop() — LLM-derived dimensions via generateObject()
 * - selectTuples() — stratified sampling (no LLM)
 * - toneToPersonaId() — maps tones to existing persona IDs
 */

import { env } from "@/env";
import type { SopStep } from "@features/sops/sops.types";
import { getLogger } from "@lib/logger";
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
    .min(1)
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
  terse: "terse-buyer",
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

/** Pick a random element from a non-empty array. */
function pick<T>(arr: T[]): T {
  if (arr.length === 0) {
    throw new Error("pick() called with empty array");
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Check if a tool state variant represents an error response. */
function isErrorVariant(variant: ToolStateVariant): boolean {
  return variant.error === true || variant.error === "true";
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
 * Pick tool state variants correlated with the edge case.
 *
 * - `tool_returns_error`, `missing_order_number` → error variants
 * - `straightforward` → success variants
 * - everything else → random
 */
const ERROR_EDGE_CASES = new Set([
  "tool_returns_error",
  "missing_order_number",
]);

const dimensionLog = getLogger();

function pickToolStateForEdgeCase(
  toolStates: Record<string, ToolStateVariant[]>,
  edgeCase: string,
): Record<string, ToolStateVariant> {
  const result: Record<string, ToolStateVariant> = {};
  for (const [slug, variants] of Object.entries(toolStates)) {
    if (ERROR_EDGE_CASES.has(edgeCase)) {
      const errorVariants = variants.filter(isErrorVariant);
      if (errorVariants.length === 0) {
        dimensionLog.warn(
          { slug, edgeCase },
          "no error variants found for tool — falling back to random variant",
        );
      }
      result[slug] =
        errorVariants.length > 0 ? pick(errorVariants) : pick(variants);
    } else if (edgeCase === "straightforward") {
      const successVariants = variants.filter((v) => !isErrorVariant(v));
      if (successVariants.length === 0) {
        dimensionLog.warn(
          { slug, edgeCase },
          "no success variants found for tool — falling back to random variant",
        );
      }
      result[slug] =
        successVariants.length > 0 ? pick(successVariants) : pick(variants);
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

  // --- Layer 1: Happy path coverage (intent x success tool states) ---
  for (const intent of dims.intents) {
    if (toolSlugs.length > 0) {
      for (const slug of toolSlugs) {
        const variants = dims.toolStates[slug];
        const successIndices = variants
          .map((v, i) => (isErrorVariant(v) ? -1 : i))
          .filter((i) => i >= 0);
        // Only use success variants for happy path; fall back to all if none
        const indices =
          successIndices.length > 0
            ? successIndices
            : variants.map((_, i) => i);
        for (const vi of indices) {
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
        toolState: pickToolStateForEdgeCase(dims.toolStates, edgeCase),
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
        toolState: pickToolStateForEdgeCase(dims.toolStates, edgeCase),
      });
    }
  }

  // --- Fill remaining with random combinations ---
  let attempts = 0;
  const maxAttempts = opts.count * 3;
  while (tuples.length < opts.count && attempts < maxAttempts) {
    attempts++;
    const edgeCase = pick(dims.edgeCases);
    addIfNew({
      intent: pick(dims.intents),
      tone: pick(dims.tones),
      complexity: pick(dims.complexity),
      edgeCase,
      toolState: pickToolStateForEdgeCase(dims.toolStates, edgeCase),
    });
  }

  return tuples;
}
