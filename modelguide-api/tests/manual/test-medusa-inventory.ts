/**
 * Quick test: call Medusa Store API directly to verify inventory_quantity
 * is returned when using the +variants.inventory_quantity fields param.
 *
 * Env vars (or create tests/manual/.env):
 *   MEDUSA_BASE_URL       — e.g. https://your-medusa.example.com
 *   MEDUSA_PUBLISHABLE_KEY — pk_xxx
 *   MEDUSA_PRODUCT_QUERY  — search term (default: "olaplex")
 *
 * Usage:
 *   bun run tests/manual/test-medusa-inventory.ts
 */

import { loadEnv } from "./mcp-helpers";

await loadEnv(import.meta.dir);

const baseUrl = process.env.MEDUSA_BASE_URL;
const publishableKey = process.env.MEDUSA_PUBLISHABLE_KEY;
const query = process.env.MEDUSA_PRODUCT_QUERY ?? "olaplex";

if (!baseUrl || !publishableKey) {
  console.error(
    "Set MEDUSA_BASE_URL and MEDUSA_PUBLISHABLE_KEY in tests/manual/.env",
  );
  process.exit(1);
}

const headers = { "x-publishable-api-key": publishableKey };

// 1. List products WITH inventory field
console.log("=== list_products (with +variants.inventory_quantity) ===");
const listUrl = `${baseUrl}/store/products?q=${query}&limit=3&fields=%2Bvariants.inventory_quantity`;
const listRes = await fetch(listUrl, { headers });
const listData = (await listRes.json()) as {
  products: {
    id: string;
    title: string;
    variants: { id: string; title: string; inventory_quantity?: number }[];
  }[];
};

for (const p of listData.products ?? []) {
  console.log(`\n  ${p.title} (${p.id})`);
  for (const v of p.variants ?? []) {
    const stock =
      v.inventory_quantity !== undefined ? v.inventory_quantity : "NOT PRESENT";
    console.log(
      `    variant ${v.title ?? v.id}: inventory_quantity = ${stock}`,
    );
  }
}

if (!listData.products?.length) {
  console.log("  No products found for query:", query);
  process.exit(0);
}

// 2. Get single product WITH inventory field
const productId = listData.products[0].id;
console.log(
  `\n=== get_product ${productId} (with +variants.inventory_quantity) ===`,
);
const getUrl = `${baseUrl}/store/products/${productId}?fields=%2Bvariants.inventory_quantity`;
const getRes = await fetch(getUrl, { headers });
const getData = (await getRes.json()) as {
  product: {
    id: string;
    title: string;
    variants: { id: string; title: string; inventory_quantity?: number }[];
  };
};

const prod = getData.product;
console.log(`\n  ${prod.title} (${prod.id})`);
for (const v of prod.variants ?? []) {
  const stock =
    v.inventory_quantity !== undefined ? v.inventory_quantity : "NOT PRESENT";
  console.log(`    variant ${v.title ?? v.id}: inventory_quantity = ${stock}`);
}

// 3. Compare: without the field
console.log(`\n=== get_product ${productId} (WITHOUT inventory field) ===`);
const bareRes = await fetch(`${baseUrl}/store/products/${productId}`, {
  headers,
});
const bareData = (await bareRes.json()) as {
  product: {
    variants: { id: string; title: string; inventory_quantity?: number }[];
  };
};
for (const v of bareData.product?.variants ?? []) {
  const stock =
    v.inventory_quantity !== undefined ? v.inventory_quantity : "NOT PRESENT";
  console.log(`    variant ${v.title ?? v.id}: inventory_quantity = ${stock}`);
}

console.log("\nDone.");
