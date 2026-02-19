import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  MCP_SERVER_URL: z.string().url("MCP_SERVER_URL must be a valid URL"),
  MCP_API_KEY: z.string().min(1, "MCP_API_KEY is required"),
  INBOX_EMAIL: z.string().email("INBOX_EMAIL must be a valid email address"),
  ORDER_LOOKUP_TOOL: z.string().min(1, "ORDER_LOOKUP_TOOL is required"),
  ZENDESK_TOOL: z.string().min(1, "ZENDESK_TOOL is required"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const error of parsed.error.errors) {
    console.error(`  - ${error.path.join(".")}: ${error.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

// Derive agent ID and API base URL from MCP_SERVER_URL
// e.g. https://host/mcp/agt_xxx → base: "https://host", agentId: "agt_xxx"
const mcpUrl = new URL(config.MCP_SERVER_URL);
const segments = mcpUrl.pathname.split("/").filter(Boolean); // ["mcp", "agt_xxx"]
export const apiBaseUrl = mcpUrl.origin;
export const agentId = segments[1] ?? "";
