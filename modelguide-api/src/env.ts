import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  MCP_SERVER_NAME: z.string().default("ModelGuide MCP"),
  MCP_SERVER_VERSION: z.string().default("1.0.0"),

  // Authentication
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("24h"),

  // Encryption for secrets
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY must be a base64-encoded 32-byte key"),

  // Application URL (for magic links)
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Magic link configuration
  MAGIC_LINK_SECRET: z
    .string()
    .min(32, "MAGIC_LINK_SECRET must be at least 32 characters"),
  MAGIC_LINK_EXPIRES_IN_MINUTES: z.coerce.number().default(15),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();

/**
 * Get the encryption key as a Buffer (32 bytes for AES-256)
 */
export function getEncryptionKey(): Uint8Array {
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return new Uint8Array(key);
}
