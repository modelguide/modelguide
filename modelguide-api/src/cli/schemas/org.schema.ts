import { z } from "zod";

export const orgSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  timezone: z.string().optional(),
  features: z.array(z.string()).optional(),
  demoEnabled: z.boolean().default(false),
});

export type OrgInput = z.infer<typeof orgSchema>;
