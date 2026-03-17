#!/usr/bin/env bun
// @ts-nocheck — manual script, depends on external demos/ directory
/**
 * End-to-end checkout flow test against a live Medusa v2 instance.
 *
 * Exercises every tool in the connector chain:
 *   1. List Products  — search the catalog
 *   2. Get Product    — fetch variant details
 *   3. Create Cart    — start a shopping session
 *   4. Add to Cart    — add a product variant
 *   5. Get Cart       — inspect cart state
 *   6. Set Address    — set delivery address
 *   7. Complete Cart  — auto-shipping + auto-payment + complete
 *   8. Get Order      — verify created order
 *
 * Usage:
 *   MEDUSA_BASE_URL=https://backend-store1.up.railway.app \
 *   MEDUSA_PUBLISHABLE_KEY=pk_... \
 *   bun run modelguide-api/tests/scripts/test-medusa-checkout-flow.ts [--dry-run]
 */

import { createSeedClients } from "../../../demos/seed-medusa/client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Error: ${name} is required.`);
    process.exit(1);
  }
  return val;
}

const baseUrl = process.env.MEDUSA_BASE_URL || "http://localhost:9000";
const publishableKey = requireEnv("MEDUSA_PUBLISHABLE_KEY");
const dryRun = process.argv.includes("--dry-run");

// Store-only client — admin token unused in this script
const { store } = createSeedClients(baseUrl, "unused", publishableKey);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stepNum = 0;

function step(label: string) {
  stepNum++;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Step ${stepNum}: ${label}`);
  console.log("─".repeat(60));
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

async function run() {
  console.log("\nMedusa Checkout Flow Test");
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Dry run: ${dryRun}`);

  // ── Step 1: List Products ──────────────────────────────────────────────
  step("List Products — search for 'olaplex'");
  const { products } = await store<{
    products: {
      id: string;
      title: string;
      variants: { id: string; title: string }[];
    }[];
  }>("/store/products", { params: { q: "olaplex", limit: 3 } });

  if (!products?.length) {
    console.error("No products found. Is the store seeded?");
    process.exit(1);
  }
  console.log(`  Found ${products.length} product(s):`);
  for (const p of products) {
    console.log(`    • ${p.title} (${p.id})`);
  }

  // ── Step 2: Get Product ────────────────────────────────────────────────
  const productId = products[0].id;
  step(`Get Product — ${productId}`);
  const { product } = await store<{
    product: {
      id: string;
      title: string;
      description: string;
      variants: {
        id: string;
        title: string;
        prices: { amount: number; currency_code: string }[];
      }[];
    };
  }>(`/store/products/${productId}`);

  console.log(`  ${product.title}`);
  console.log(`  ${product.description?.slice(0, 80)}...`);
  console.log("  Variants:");
  for (const v of product.variants ?? []) {
    const price = v.prices?.[0];
    console.log(
      `    • ${v.title} (${v.id}) — ${price ? `${price.amount} ${price.currency_code}` : "no price"}`,
    );
  }

  const variantId = product.variants?.[0]?.id;
  if (!variantId) {
    console.error("Product has no variants.");
    process.exit(1);
  }

  // ── Step 3: Create Cart ────────────────────────────────────────────────
  step("Create Cart");
  const { cart: newCart } = await store<{
    cart: { id: string; region_id: string; currency_code: string };
  }>("/store/carts", { method: "POST", body: {} });

  const cartId = newCart.id;
  console.log(`  Cart ID:  ${cartId}`);
  console.log(`  Region:   ${newCart.region_id}`);
  console.log(`  Currency: ${newCart.currency_code}`);

  // ── Step 4: Add to Cart ────────────────────────────────────────────────
  step(`Add to Cart — ${variantId} x1`);
  const { cart: cartAfterAdd } = await store<{
    cart: {
      id: string;
      items: {
        id: string;
        title: string;
        quantity: number;
        unit_price: number;
      }[];
    };
  }>(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity: 1 },
  });

  for (const item of cartAfterAdd.items ?? []) {
    console.log(`  • ${item.title} x${item.quantity} — ${item.unit_price}`);
  }

  // ── Step 5: Get Cart ───────────────────────────────────────────────────
  step("Get Cart — verify state");
  const { cart: cartState } = await store<{
    cart: {
      id: string;
      total: number;
      items: { id: string }[];
      shipping_address: unknown;
      shipping_methods: unknown[];
      payment_collection: unknown;
    };
  }>(`/store/carts/${cartId}`);

  console.log(`  Items:              ${cartState.items?.length ?? 0}`);
  console.log(`  Total:              ${cartState.total}`);
  console.log(
    `  Shipping address:   ${cartState.shipping_address ? "set" : "none"}`,
  );
  console.log(
    `  Shipping methods:   ${cartState.shipping_methods?.length ?? 0}`,
  );
  console.log(
    `  Payment collection: ${cartState.payment_collection ? "yes" : "none"}`,
  );

  // ── Step 6: Set Delivery Address ───────────────────────────────────────
  step("Set Delivery Address");
  await store(`/store/carts/${cartId}`, {
    method: "POST",
    body: {
      shipping_address: {
        first_name: "Test",
        last_name: "Checkout",
        address_1: "123 Flow Street",
        address_2: "",
        city: "Copenhagen",
        postal_code: "1000",
        country_code: "dk",
        phone: "+4512345678",
      },
    },
  });
  console.log("  Address set: Test Checkout, 123 Flow Street, Copenhagen DK");

  // ── Step 7: Complete Cart ──────────────────────────────────────────────
  step("Complete Cart (auto-shipping + auto-payment)");

  if (dryRun) {
    console.log("  [DRY RUN] Skipping cart completion.");
    console.log("\n  All steps up to completion passed.\n");
    return;
  }

  // Replicate the completeCart handler logic to test the full chain:
  // 7a. Fetch cart
  const { cart: preComplete } = await store<{
    cart: {
      shipping_methods?: { id: string }[];
      payment_collection?: { id: string };
      region_id?: string;
    };
  }>(`/store/carts/${cartId}`);

  console.log("  7a. Cart fetched");
  console.log(
    `      Shipping methods: ${preComplete.shipping_methods?.length ?? 0}`,
  );
  console.log(
    `      Payment collection: ${preComplete.payment_collection?.id ?? "none"}`,
  );

  // 7b. Auto-select shipping if needed
  if (!preComplete.shipping_methods?.length) {
    const { shipping_options } = await store<{
      shipping_options: { id: string; amount: number; name: string }[];
    }>("/store/shipping-options", { params: { cart_id: cartId } });

    if (!shipping_options?.length) {
      console.error("  No shipping options available!");
      process.exit(1);
    }

    const cheapest = shipping_options.reduce((min, opt) =>
      opt.amount < min.amount ? opt : min,
    );
    console.log(
      `  7b. Auto-selecting shipping: ${cheapest.name} (${cheapest.id}) — ${cheapest.amount}`,
    );

    await store(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: cheapest.id },
    });
  } else {
    console.log("  7b. Shipping already set, skipping.");
  }

  // 7c. Re-fetch cart and ensure payment collection exists
  const { cart: afterShipping } = await store<{
    cart: {
      payment_collection?: { id: string };
      region_id?: string;
    };
  }>(`/store/carts/${cartId}`);

  let paycolId = afterShipping.payment_collection?.id;
  const regionId = afterShipping.region_id;

  if (!paycolId) {
    console.log("  7c. No payment collection — creating one...");
    const { payment_collection } = await store<{
      payment_collection: { id: string };
    }>("/store/payment-collections", {
      method: "POST",
      body: { cart_id: cartId },
    });
    paycolId = payment_collection.id;
  }

  console.log(`  7c. Payment collection: ${paycolId}`);
  console.log(`      Region: ${regionId ?? "MISSING"}`);

  if (!paycolId || !regionId) {
    console.error("  Cart missing payment collection or region!");
    process.exit(1);
  }

  // 7d. Resolve payment provider
  const { payment_providers } = await store<{
    payment_providers: { id: string }[];
  }>("/store/payment-providers", { params: { region_id: regionId } });

  const providerId = payment_providers?.[0]?.id;
  console.log(`  7d. Payment provider: ${providerId ?? "NONE"}`);

  if (!providerId) {
    console.error("  No payment providers available!");
    process.exit(1);
  }

  // 7e. Create payment session
  await store(`/store/payment-collections/${paycolId}/payment-sessions`, {
    method: "POST",
    body: { provider_id: providerId },
  });
  console.log("  7e. Payment session created");

  // 7f. Complete the cart
  const completion = await store<{
    type: string;
    order?: { id: string; display_id: number; status: string };
  }>(`/store/carts/${cartId}/complete`, { method: "POST" });

  if (completion.type !== "order" || !completion.order) {
    console.error("  Cart completion did not return an order!");
    console.error("  Response:", JSON.stringify(completion, null, 2));
    process.exit(1);
  }

  const order = completion.order;
  console.log("  7f. Order created!");
  console.log(`      Order ID:    ${order.id}`);
  console.log(`      Display ID:  #${order.display_id}`);
  console.log(`      Status:      ${order.status}`);

  // ── Step 8: Get Order ──────────────────────────────────────────────────
  step(`Get Order — ${order.id}`);
  const { order: fetchedOrder } = await store<{
    order: {
      id: string;
      display_id: number;
      status: string;
      total: number;
      currency_code: string;
    };
  }>(`/store/orders/${order.id}`);

  console.log(`  Order #${fetchedOrder.display_id}`);
  console.log(`  Status:   ${fetchedOrder.status}`);
  console.log(
    `  Total:    ${fetchedOrder.total} ${fetchedOrder.currency_code}`,
  );

  // ── Done ───────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("  All 8 steps passed!");
  console.log(`${"═".repeat(60)}\n`);
}

run().catch((err) => {
  console.error("\nFailed:", err.message ?? err);
  process.exit(1);
});
