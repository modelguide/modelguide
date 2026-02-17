/**
 * Manual E2E test: create a session, then call the Zendesk create_ticket tool via MCP.
 *
 * Usage:
 *   bun run tests/manual/mcp-zendesk-ticket.ts
 */

import { loadEnv, setupMcpTest } from "./mcp-helpers";

await loadEnv(import.meta.dir);

const ctx = await setupMcpTest();
const tool = ctx.toolName("create_ticket");

console.log(`\n=== Calling ${tool} ===`);
const result = await ctx.client.callTool({
  name: tool,
  arguments: {
    session_id: ctx.sessionId,
    subject: "Test ticket from MCP",
    description: "This is a test ticket created via ModelGuide MCP endpoint.",
    body: "This is a test ticket created via ModelGuide MCP endpoint.",
    priority: "low",
    requesterEmail: "test@modelguide.ai",
    tags: ["test", "mcp"],
  },
});

console.log("\nResult:", JSON.stringify(result, null, 2));

await ctx.cleanup();
process.exit(0);
