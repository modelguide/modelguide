import { z } from "zod";

const envSchema = z.object({
  MG_API_URL: z.string().url().default("http://localhost:3000"),
  MG_AGENT_ID: z.string().uuid(),
  MG_API_KEY: z.string().startsWith("mgk_"),
  OPENAI_API_KEY: z.string(),
});

export type EvalEnv = z.infer<typeof envSchema>;

let cachedEnv: EvalEnv | null = null;

export function getEnv(): EvalEnv {
  if (cachedEnv) return cachedEnv;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${errors}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

export function validateEnv(): void {
  getEnv();
}
