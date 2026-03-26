import { z } from "zod";

const sopStatuses = ["draft", "active", "archived"] as const;

const sopStepSchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  required: z.boolean().default(true),
  tool: z
    .object({
      connectorSlug: z.string().min(1),
      toolSlug: z.string().min(1),
    })
    .optional(),
});

const sopTriggerSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.unknown()).default({}),
});

/**
 * SOP: either fork from a template or define inline.
 * - Template fork: templateSlug + connectorMapping
 * - Inline: trigger + steps
 */
export const sopItemSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(sopStatuses).default("draft"),
    agents: z.array(z.string()).default([]),

    // Template fork fields
    templateSlug: z.string().optional(),
    connectorMapping: z.record(z.string()).optional(),

    // Inline fields
    trigger: sopTriggerSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    steps: z.array(sopStepSchema).optional(),
  })
  .refine((s) => !(s.templateSlug && s.steps), {
    message:
      "Cannot specify both templateSlug and steps — use one or the other",
  });

export const sopsFileSchema = z.object({
  sops: z.array(sopItemSchema).min(1),
});

export type SopItemInput = z.infer<typeof sopItemSchema>;
