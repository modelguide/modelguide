import { z } from "zod";

export const guardrailItemSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  content: z.string().min(1),
  description: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  agents: z.array(z.string()).default([]),
});

export const guardrailsFileSchema = z.object({
  guardrails: z.array(guardrailItemSchema).min(1),
});

export type GuardrailItemInput = z.infer<typeof guardrailItemSchema>;
