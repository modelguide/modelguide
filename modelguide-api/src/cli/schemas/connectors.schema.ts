import { z } from "zod";
import { secretTypes } from "./secrets.schema";

const connectorSecretSchema = z.object({
  field: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(secretTypes),
  value: z.string().optional(), // populated interactively or via --skip-secrets
});

const mockedToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  input_schema: z.record(z.unknown()).default({}),
  mock_response: z.record(z.unknown()),
});

const realConnectorSchema = z.object({
  isMocked: z.literal(false).optional(),
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

const mockedConnectorSchema = z.object({
  isMocked: z.literal(true),
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_]+$/,
      "Slug must be lowercase alphanumeric with underscores",
    ),
  iconUrl: z.string().min(1).max(500).optional(),
  tools: z.array(mockedToolSchema).min(1),
});

export const connectorItemSchema = z.discriminatedUnion("isMocked", [
  mockedConnectorSchema,
  realConnectorSchema,
]);

export const connectorsFileSchema = z.object({
  connectors: z.array(connectorItemSchema).min(1),
});

export type RealConnectorInput = z.infer<typeof realConnectorSchema>;
export type MockedConnectorInput = z.infer<typeof mockedConnectorSchema>;
export type ConnectorItemInput = z.infer<typeof connectorItemSchema>;
export type MockedToolInput = z.infer<typeof mockedToolSchema>;
