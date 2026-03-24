import { z } from "zod";

const secretTypes = [
  "api_key",
  "oauth_token",
  "credentials",
  "platform_api_key",
  "webhook_secret",
] as const;

const secretScopes = ["connector", "agent"] as const;

export const secretItemSchema = z.object({
  name: z.string().min(1),
  value: z.string().optional(), // prompted interactively if missing
  type: z.enum(secretTypes),
  scope: z.enum(secretScopes).optional(),
});

export const secretsFileSchema = z.object({
  secrets: z.array(secretItemSchema).min(1),
});

export type SecretItemInput = z.infer<typeof secretItemSchema>;
