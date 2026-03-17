/**
 * Manual E2E test: create a session, then call the Medusa look_up_order tool via MCP.
 *
 * Extra env vars:
 *   MG_ORDER_EMAIL       — customer email to look up
 *   MG_ORDER_DISPLAY_ID  — order display ID (e.g. "1001")
 *
 * Usage:
 *   bun run tests/manual/mcp-medusa-order-lookup.ts
 */

import { loadEnv, requireEnv, setupMcpTest } from "./mcp-helpers";

await loadEnv(import.meta.dir);

const orderEmail = requireEnv("MG_ORDER_EMAIL");
const orderDisplayId = Number(requireEnv("MG_ORDER_DISPLAY_ID"));

const ctx = await setupMcpTest({
  userIdentifier: orderEmail,
});
const tool = ctx.toolName("look_up_order");

console.log(`\n=== Calling ${tool} ===`);
console.log(`  email: ${orderEmail}`);
console.log(`  displayId: ${orderDisplayId}`);

const result = await ctx.client.callTool({
  name: tool,
  arguments: {
    session_id: ctx.sessionId,
    email: orderEmail,
    displayId: orderDisplayId,
  },
});

console.log("\nResult:", JSON.stringify(result, null, 2));

await ctx.cleanup();
process.exit(0);
