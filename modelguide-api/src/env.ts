import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    DATABASE_URL: z.string().url(),
    MCP_SERVER_NAME: z.string().default("ModelGuide MCP"),
    MCP_SERVER_VERSION: z.string().default("1.0.0"),

    // Authentication
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN: z.string().default("15m"),
    REFRESH_JWT_SECRET: z
      .string()
      .min(32, "REFRESH_JWT_SECRET must be at least 32 characters"),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
    REFRESH_SESSION_RETENTION_DAYS: z.coerce.number().default(90),

    // Encryption for secrets
    ENCRYPTION_KEY: z
      .string()
      .min(32, "ENCRYPTION_KEY must be at least 32 characters"),

    // Application URL (for magic links and CSRF origin validation).
    // Must match the UI origin, not the API listen address.
    // E.g., with Vite proxy on :3001 → API on :3000, set APP_URL=http://localhost:3001
    APP_URL: z.string().url().default("http://localhost:3000"),

    // Magic link configuration
    MAGIC_LINK_SECRET: z
      .string()
      .min(32, "MAGIC_LINK_SECRET must be at least 32 characters"),
    MAGIC_LINK_EXPIRES_IN_MINUTES: z.coerce.number().default(15),
    MAGIC_LINK_STRATEGY: z.enum(["console", "resend"]).default("console"),

    // Resend email configuration
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),

    // Public API address reachable by external services (e.g., Railway load balancer URL).
    // Used for ElevenLabs sync (MCP server URL, webhook URL) and integration URL display.
    // Falls back to APP_URL if not set.
    API_EXTERNAL_ADDRESS: z.string().url().optional(),

    // CORS allowed origins (comma-separated). Leave empty to disable CORS.
    // E.g. "http://localhost:5173,https://demo.example.com"
    CORS_ORIGINS: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV !== "production") return true;
      const defaults = ["change-me", "modelguide-local-dev"];
      const secrets = [
        data.JWT_SECRET,
        data.REFRESH_JWT_SECRET,
        data.ENCRYPTION_KEY,
        data.MAGIC_LINK_SECRET,
      ];
      return secrets.every(
        (s) => !defaults.some((d) => s.toLowerCase().startsWith(d)),
      );
    },
    {
      message:
        "Default/placeholder secrets detected — set real secrets for production",
    },
  )
  .refine(
    (data) =>
      data.MAGIC_LINK_STRATEGY !== "resend" || data.RESEND_API_KEY != null,
    {
      message:
        "RESEND_API_KEY is required when MAGIC_LINK_STRATEGY is 'resend'",
      path: ["RESEND_API_KEY"],
    },
  )
  .refine(
    (data) =>
      data.MAGIC_LINK_STRATEGY !== "resend" || data.RESEND_FROM_EMAIL != null,
    {
      message:
        "RESEND_FROM_EMAIL is required when MAGIC_LINK_STRATEGY is 'resend'",
      path: ["RESEND_FROM_EMAIL"],
    },
  );

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.issues);
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
