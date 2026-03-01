/**
 * Manual E2E test: create a session, then call list_products and get_product
 * via MCP to verify inventory data is returned.
 *
 * Extra env vars:
 *   MG_PRODUCT_QUERY — search term (default: "olaplex")
 *
 * Usage:
 *   bun run tests/manual/mcp-medusa-products.ts
 */

import { loadEnv, setupMcpTest } from "./mcp-helpers";

await loadEnv(import.meta.dir);

const query = process.env.MG_PRODUCT_QUERY ?? "olaplex";

const ctx = await setupMcpTest();

// 1. List products
const listTool = ctx.toolName("list_products");
console.log(`\n=== Calling ${listTool} ===`);
console.log(`  query: ${query}`);

const listResult = await ctx.client.callTool({
  name: listTool,
  arguments: {
    session_id: ctx.sessionId,
    query,
    limit: 5,
  },
});

console.log("\nlist_products result:", JSON.stringify(listResult, null, 2));

// 2. Get first product details
const content = listResult.content as { type: string; text: string }[];
const text = content?.find((c) => c.type === "text")?.text;
const parsed = text ? JSON.parse(text) : null;
const firstProduct = parsed?.data?.products?.[0];

if (firstProduct) {
  const getTool = ctx.toolName("get_product");
  console.log(`\n=== Calling ${getTool} ===`);
  console.log(`  productId: ${firstProduct.id}`);

  const getResult = await ctx.client.callTool({
    name: getTool,
    arguments: {
      session_id: ctx.sessionId,
      productId: firstProduct.id,
    },
  });

  console.log("\nget_product result:", JSON.stringify(getResult, null, 2));
} else {
  console.log("\nNo products found — skipping get_product");
}

await ctx.cleanup();
process.exit(0);
