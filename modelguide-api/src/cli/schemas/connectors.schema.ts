import { z } from "zod";
import { secretTypes } from "./secrets.schema";

const connectorSecretSchema = z.object({
  field: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(secretTypes),
  value: z.string().optional(), // populated interactively or via --skip-secrets
});

export const connectorItemSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_]+$/,
      "Slug must be lowercase alphanumeric with underscores",
    ),
  catalogSlug: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  secrets: z.array(connectorSecretSchema).default([]),
});

export const connectorsFileSchema = z.object({
  connectors: z.array(connectorItemSchema).min(1),
});

export type ConnectorItemInput = z.infer<typeof connectorItemSchema>;
