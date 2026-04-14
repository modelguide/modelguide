/**
 * Curated list of ElevenLabs LLM models for use in conversational AI agents.
 *
 * Only non-dated alias IDs are included (e.g. "gpt-4o", not "gpt-4o-2024-08-06").
 * Models outside gpt/claude/gemini families are grouped under "generic".
 * "custom-llm" is excluded.
 *
 * All IDs must be valid `Llm` values — TypeScript compilation fails if any ID
 * drifts from the SDK's type definition.
 */

// `Llm` is not re-exported from the package root as of @elevenlabs/elevenlabs-js@2.x.
// This internal dist path can change without a semver break — pin the SDK version
// tightly in package.json and update this import when upgrading.
import type { Llm } from "@elevenlabs/elevenlabs-js/dist/api/types/Llm";

export type ModelFamily = "gpt" | "claude" | "gemini" | "generic";

export interface ElevenLabsModel {
  id: Llm;
  label: string;
  family: ModelFamily;
}

export interface ElevenLabsModelGroup {
  family: ModelFamily;
  models: { id: string; label: string }[];
}

export const ELEVENLABS_MODELS: ElevenLabsModel[] = [
  // GPT family
  { id: "gpt-4o", label: "GPT-4o", family: "gpt" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", family: "gpt" },
  { id: "gpt-4.1", label: "GPT-4.1", family: "gpt" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", family: "gpt" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", family: "gpt" },
  { id: "gpt-5", label: "GPT-5", family: "gpt" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", family: "gpt" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", family: "gpt" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo", family: "gpt" },
  { id: "gpt-4", label: "GPT-4", family: "gpt" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", family: "gpt" },

  // Claude family
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", family: "claude" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4", family: "claude" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", family: "claude" },
  { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", family: "claude" },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", family: "claude" },
  { id: "claude-3-haiku", label: "Claude 3 Haiku", family: "claude" },

  // Gemini family
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", family: "gemini" },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    family: "gemini",
  },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", family: "gemini" },
  {
    id: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    family: "gemini",
  },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", family: "gemini" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", family: "gemini" },

  // Generic family (Grok, Qwen, Watt, GLM)
  { id: "grok-beta", label: "Grok Beta", family: "generic" },
  { id: "qwen3-4b", label: "Qwen3 4B", family: "generic" },
  { id: "qwen3-30b-a3b", label: "Qwen3 30B A3B", family: "generic" },
  { id: "watt-tool-8b", label: "Watt Tool 8B", family: "generic" },
  { id: "watt-tool-70b", label: "Watt Tool 70B", family: "generic" },
  { id: "glm-45-air-fp8", label: "GLM-4.5 Air FP8", family: "generic" },
  { id: "gpt-oss-20b", label: "GPT OSS 20B", family: "generic" },
  { id: "gpt-oss-120b", label: "GPT OSS 120B", family: "generic" },
];

/**
 * Returns the curated model list grouped by family.
 * When `family` is "generic", all models from all families are returned combined.
 * When a specific family is provided, only models from that family are returned.
 */
export function getElevenLabsModelGroups(
  filterFamily?: ModelFamily,
): ElevenLabsModelGroup[] {
  if (filterFamily === "generic") {
    // "generic" filter returns all models combined, ungrouped under generic
    return [
      {
        family: "generic" as ModelFamily,
        models: ELEVENLABS_MODELS.map(({ id, label }) => ({ id, label })),
      },
    ];
  }

  const families: ModelFamily[] = filterFamily
    ? [filterFamily]
    : ["gpt", "claude", "gemini", "generic"];

  return families.map((family) => ({
    family,
    models: ELEVENLABS_MODELS.filter((m) => m.family === family).map(
      ({ id, label }) => ({ id, label }),
    ),
  }));
}
