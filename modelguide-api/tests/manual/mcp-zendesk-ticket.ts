/**
 * Manual E2E test: create a session, then call the Zendesk create_ticket tool via MCP.
 *
 * Required env vars:
 *   MG_BASE_URL        — e.g. http://localhost:3000
 *   MG_AGENT_ID        — agent UUID
 *   MG_API_KEY         — mgk_... API key
 *   MG_CONNECTOR_SLUG  — Zendesk connector slug (e.g. "acme_zendesk")
 *
 * Setup:
 *   cp tests/manual/.env.example tests/manual/.env
 *   # fill in values in tests/manual/.env
 *
 * Usage:
 *   bun run tests/manual/mcp-zendesk-ticket.ts
 */

import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Load .env from tests/manual/.env
const envPath = resolve(import.meta.dir, ".env");
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
    console.warn(
      "No tests/manual/.env found, falling back to exported env vars",
    );
  });

const BASE_URL = requireEnv("MG_BASE_URL");
const AGENT_ID = requireEnv("MG_AGENT_ID");
const API_KEY = requireEnv("MG_API_KEY");
const CONNECTOR_SLUG = requireEnv("MG_CONNECTOR_SLUG");

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function request(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

// Step 1: Create a session via REST
console.log("=== Creating session ===");
const sessionRes = await request("/api/sessions", {
  method: "POST",
  body: JSON.stringify({
    channelType: "voice",
    userIdentifier: "+1234567890",
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

// Step 2: Connect MCP client
console.log("\n=== Connecting MCP client ===");
const transport = new StreamableHTTPClientTransport(
  new URL(`${BASE_URL}/mcp/${AGENT_ID}`),
  {
    requestInit: {
      headers: { Authorization: `Bearer ${API_KEY}` },
    },
  },
);

const client = new Client({ name: "manual-test", version: "1.0.0" });
await client.connect(transport);
console.log("MCP connected");

// Step 3: List tools
console.log("\n=== Listing tools ===");
const { tools } = await client.listTools();
console.log(
  "Available tools:",
  tools.map((t) => t.name),
);

// Step 4: Call create_ticket
const toolName = `${CONNECTOR_SLUG}_create_ticket`;
console.log(`\n=== Calling ${toolName} ===`);

const result = await client.callTool({
  name: toolName,
  arguments: {
    session_id: session.id,
    subject: "Test ticket from MCP",
    description: "This is a test ticket created via ModelGuide MCP endpoint.",
    body: "This is a test ticket created via ModelGuide MCP endpoint.",
    priority: "low",
    requesterEmail: "test@modelguide.ai",
    tags: ["test", "mcp"],
  },
});

console.log("\nResult:", JSON.stringify(result, null, 2));

// Cleanup: close session
console.log("\n=== Closing session ===");
const closeRes = await request(`/api/sessions/${session.id}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "completed" }),
});
console.log("Session closed:", closeRes.status);

await client.close();
process.exit(0);
