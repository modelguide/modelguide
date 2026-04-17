import { guardrailConfigSchema } from "@features/knowledge-base/knowledge-base.schemas";
import { z } from "zod";

// Reuse the service-layer guardrail config schema so CLI imports fail fast on
// anything the compiler would later reject (e.g. missing `priority`, unknown
// `category`). Historically the CLI accepted `config: {}`, which made
// `mg import-guardrails` succeed on YAML that then broke `compile-agents`.
export const guardrailItemSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  content: z.string().min(1),
  description: z.string().optional(),
  config: guardrailConfigSchema,
  agents: z.array(z.string()).default([]),
});

export const guardrailsFileSchema = z.object({
  guardrails: z.array(guardrailItemSchema).min(1),
});

export type GuardrailItemInput = z.infer<typeof guardrailItemSchema>;
