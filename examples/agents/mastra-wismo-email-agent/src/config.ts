import { z } from "zod";

const isDev = process.env.NODE_ENV === "development";

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  MCP_SERVER_URL: z.string().url("MCP_SERVER_URL must be a valid URL"),
  MCP_API_KEY: z.string().min(1, "MCP_API_KEY is required"),
  INBOX_EMAIL: z.string().email("INBOX_EMAIL must be a valid email address"),
  RESEND_WEBHOOK_SECRET: isDev
    ? z.string().optional()
    : z.string().min(1, "RESEND_WEBHOOK_SECRET is required in production"),
  ORDER_LOOKUP_TOOL: z.string().min(1, "ORDER_LOOKUP_TOOL is required"),
  ZENDESK_TOOL: z.string().min(1, "ZENDESK_TOOL is required"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  AGENT_MODEL: z.string().default("anthropic/claude-sonnet-4-6-20250514"),
  AGENT_MODEL_INPUT_COST: z.coerce.number().default(3),
  AGENT_MODEL_OUTPUT_COST: z.coerce.number().default(15),
  AGENT_INSTRUCTIONS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const error of parsed.error.errors) {
    console.error(`  - ${error.path.join(".")}: ${error.message}`);
  }
  process.exit(1);
}

if (isDev && !parsed.data.RESEND_WEBHOOK_SECRET) {
  console.warn("RESEND_WEBHOOK_SECRET is not set — webhook signature verification disabled (dev mode)");
}

export const config = parsed.data;
export { isDev };

// Derive agent ID and API base URL from MCP_SERVER_URL
// e.g. https://host/mcp/agt_xxx → base: "https://host", agentId: "agt_xxx"
const mcpUrl = new URL(config.MCP_SERVER_URL);
const segments = mcpUrl.pathname.split("/").filter(Boolean); // ["mcp", "agt_xxx"]
export const apiBaseUrl = mcpUrl.origin;
export const agentId = segments[1] ?? "";
