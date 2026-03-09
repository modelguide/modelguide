/**
 * Shared helpers for manual MCP test scripts.
 */

import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

export async function loadEnv(dir: string): Promise<void> {
  const envPath = resolve(dir, ".env");
  await Bun.file(envPath)
    .text()
    .then((text) => {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    })
    .catch(() => {
      console.warn("No .env found at", envPath, "— using exported env vars");
    });
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// REST + MCP client
// ---------------------------------------------------------------------------

export interface McpTestContext {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  connectorSlug: string;
  client: Client;
  sessionId: string;
  /** Convenience: prefixed tool name */
  toolName(tool: string): string;
  /** Authenticated REST request against the API */
  request(path: string, options?: RequestInit): Promise<Response>;
  /** Close session + disconnect MCP client */
  cleanup(): Promise<void>;
}

interface SetupOptions {
  /** Customer phone number */
  customerPhone?: string;
  channelType?: string;
}

export async function setupMcpTest(
  opts: SetupOptions = {},
): Promise<McpTestContext> {
  const baseUrl = requireEnv("MG_BASE_URL");
  const agentId = requireEnv("MG_AGENT_ID");
  const apiKey = requireEnv("MG_API_KEY");
  const connectorSlug = requireEnv("MG_CONNECTOR_SLUG");

  const request = (path: string, options?: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

  // Create session
  console.log("=== Creating session ===");
  const sessionRes = await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      channelType: opts.channelType ?? "voice",
      customer: { phone: opts.customerPhone ?? "+1234567890" },
    }),
  });

  if (!sessionRes.ok) {
    console.error(
      "Failed to create session:",
      sessionRes.status,
      await sessionRes.text(),
    );
    process.exit(1);
  }

  const session = (await sessionRes.json()) as { id: string };
  console.log("Session created:", session.id);

  // Connect MCP
  console.log("\n=== Connecting MCP client ===");
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp/${agentId}`),
    { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
  );

  const client = new Client({ name: "manual-test", version: "1.0.0" });
  await client.connect(transport);
  console.log("MCP connected");

  // List tools
  console.log("\n=== Listing tools ===");
  const { tools } = await client.listTools();
  console.log(
    "Available tools:",
    tools.map((t) => t.name),
  );

  return {
    baseUrl,
    agentId,
    apiKey,
    connectorSlug,
    client,
    sessionId: session.id,
    toolName: (tool) => `${connectorSlug}_${tool}`,
    request,
    async cleanup() {
      console.log("\n=== Closing session ===");
      const closeRes = await request(`/api/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      });
      console.log("Session closed:", closeRes.status);
      await client.close();
    },
  };
}
