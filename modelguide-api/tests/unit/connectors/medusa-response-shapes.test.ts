/**
 * Unit tests for Medusa response shape trimming.
 * Verifies that trimToShape() and convenience trimmers strip noise fields
 * while preserving the allowlisted structure.
 */

import { describe, expect, test } from "bun:test";
import {
  trimCart,
  trimOrder,
  trimProduct,
  trimProducts,
  trimReturn,
  trimToShape,
} from "@features/connectors/catalog/medusa/response-shapes";

// ---------------------------------------------------------------------------
// trimToShape — generic utility
// ---------------------------------------------------------------------------

describe("trimToShape", () => {
  test("keeps only allowlisted top-level keys", () => {
    const result = trimToShape(
      { id: "123", name: "Alice", secret: "x", extra: 99 },
      { id: true, name: true },
    );
    expect(result).toEqual({ id: "123", name: "Alice" });
  });

  test("handles nested shape objects", () => {
    const result = trimToShape(
      {
        id: "1",
        address: {
          city: "NYC",
          zip: "10001",
          internal_ref: "xyz",
        },
      },
      { id: true, address: { city: true, zip: true } },
    );
    expect(result).toEqual({
      id: "1",
      address: { city: "NYC", zip: "10001" },
    });
  });

  test("trims arrays of objects", () => {
    const result = trimToShape(
      {
        items: [
          { id: "a", title: "Item A", raw_data: {} },
          { id: "b", title: "Item B", raw_data: {} },
        ],
      },
      { items: { id: true, title: true } },
    );
    expect(result).toEqual({
      items: [
        { id: "a", title: "Item A" },
        { id: "b", title: "Item B" },
      ],
    });
  });

  test("silently skips missing keys", () => {
    const result = trimToShape(
      { id: "1" },
      { id: true, name: true, missing_nested: { x: true } },
    );
    expect(result).toEqual({ id: "1" });
  });

  test("returns null for null/undefined input", () => {
    expect(trimToShape(null, { id: true })).toBeNull();
    expect(trimToShape(undefined, { id: true })).toBeNull();
  });

  test("preserves primitive arrays (true spec)", () => {
    const result = trimToShape({ tags: ["a", "b", "c"] }, { tags: true });
    expect(result).toEqual({ tags: ["a", "b", "c"] });
  });

  test("deeply nested shapes work recursively", () => {
    const result = trimToShape(
      {
        level1: {
          level2: {
            keep: "yes",
            drop: "no",
          },
          also_drop: true,
        },
      },
      { level1: { level2: { keep: true } } },
    );
    expect(result).toEqual({
      level1: { level2: { keep: "yes" } },
    });
  });
});

// ---------------------------------------------------------------------------
// trimOrder
// ---------------------------------------------------------------------------

describe("trimOrder", () => {
  const fullOrder = {
    id: "order_123",
    display_id: 1042,
    email: "alice@example.com",
    status: "completed",
    total: 5999,
    currency_code: "usd",
    created_at: "2026-01-15T10:00:00Z",
    fulfillment_status: "shipped",
    payment_status: "captured",
    shipping_address: {
      first_name: "Alice",
      last_name: "Smith",
      address_1: "123 Main St",
      address_2: "",
      city: "Portland",
      postal_code: "97201",
      country_code: "us",
      phone: "555-1234",
      company: "Acme Co",
      province: "OR",
    },
    items: [
      {
        id: "item_1",
        title: "Moisturizer",
        subtitle: "50ml",
        quantity: 2,
        unit_price: 2999,
        total: 5998,
        subtotal: 5998,
        product_id: "prod_1",
        variant_id: "var_1",
        variant_sku: "MOIST-50",
        product_title: "CeraVe Moisturizer",
        variant_title: "50ml",
        product_description: "Hydrating cream",
        thumbnail: "https://example.com/thumb.jpg",
        discount_total: 0,
        discount_subtotal: 0,
        original_total: 5998,
        original_subtotal: 5998,
        shipped_quantity: 2,
        delivered_quantity: 2,
        fulfilled_quantity: 2,
        return_requested_quantity: 0,
        return_received_quantity: 0,
        return_dismissed_quantity: 0,
        written_off_quantity: 0,
        variant: { id: "var_1", title: "50ml" },
        // Noise fields
        raw_unit_price: { value: "2999", precision: 20 },
        raw_total: { value: "5998", precision: 20 },
        tax_lines: [],
        tax_total: 0,
        is_tax_inclusive: false,
        adjustments: [],
        detail: { id: "detail_1", version: 3 },
        created_at: "2026-01-15T10:00:00Z",
        updated_at: "2026-01-15T10:00:00Z",
        metadata: null,
        is_giftcard: false,
        is_custom_price: false,
      },
    ],
    // Noise fields
    raw_total: { value: "5999", precision: 20 },
    summary: { pending_difference: 0 },
    version: 3,
    metadata: null,
    updated_at: "2026-01-15T10:01:00Z",
  };

  test("strips noise fields from order", () => {
    const result = trimOrder(fullOrder as Record<string, unknown>);
    expect(result).not.toBeNull();

    // Kept fields
    expect(result!.id).toBe("order_123");
    expect(result!.display_id).toBe(1042);
    expect(result!.email).toBe("alice@example.com");
    expect(result!.status).toBe("completed");
    expect(result!.fulfillment_status).toBe("shipped");
    expect(result!.payment_status).toBe("captured");

    // Removed fields
    expect(result!.raw_total).toBeUndefined();
    expect(result!.summary).toBeUndefined();
    expect(result!.version).toBeUndefined();
    expect(result!.metadata).toBeUndefined();
    expect(result!.updated_at).toBeUndefined();
  });

  test("strips noise fields from order items", () => {
    const result = trimOrder(fullOrder as Record<string, unknown>);
    const items = result!.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);

    const item = items[0];
    // Kept
    expect(item.id).toBe("item_1");
    expect(item.title).toBe("Moisturizer");
    expect(item.shipped_quantity).toBe(2);
    expect(item.variant).toEqual({ id: "var_1", title: "50ml" });

    // Removed
    expect(item.raw_unit_price).toBeUndefined();
    expect(item.raw_total).toBeUndefined();
    expect(item.tax_lines).toBeUndefined();
    expect(item.detail).toBeUndefined();
    expect(item.adjustments).toBeUndefined();
    expect(item.created_at).toBeUndefined();
    expect(item.updated_at).toBeUndefined();
    expect(item.metadata).toBeUndefined();
    expect(item.is_giftcard).toBeUndefined();
  });

  test("trims shipping_address to allowed fields", () => {
    const result = trimOrder(fullOrder as Record<string, unknown>);
    const addr = result!.shipping_address as Record<string, unknown>;
    expect(addr.first_name).toBe("Alice");
    expect(addr.city).toBe("Portland");
    expect(addr.company).toBeUndefined();
    expect(addr.province).toBeUndefined();
  });

  test("returns null for null input", () => {
    expect(trimOrder(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// trimProduct / trimProducts
// ---------------------------------------------------------------------------

describe("trimProduct", () => {
  test("keeps product fields and trims variants", () => {
    const product = {
      id: "prod_1",
      title: "CeraVe",
      subtitle: "Moisturizer",
      description: "Hydrating",
      handle: "cerave",
      status: "published",
      thumbnail: "https://example.com/t.jpg",
      images: [{ url: "https://example.com/i.jpg" }],
      variants: [
        {
          id: "var_1",
          title: "50ml",
          sku: "C-50",
          prices: [{ amount: 1999, currency_code: "usd" }],
          inventory_quantity: 42,
          options: [{ value: "50ml" }],
          ean: "1234567890",
          upc: "098765",
          hs_code: "3304",
          weight: 100,
        },
      ],
      options: [{ id: "opt_1", title: "Size", values: ["50ml", "100ml"] }],
      // Noise
      raw_metadata: {},
      type_id: "type_1",
    };

    const result = trimProduct(product as unknown as Record<string, unknown>);
    expect(result!.id).toBe("prod_1");
    expect(result!.title).toBe("CeraVe");
    expect(result!.raw_metadata).toBeUndefined();
    expect(result!.type_id).toBeUndefined();

    const variants = result!.variants as Record<string, unknown>[];
    expect(variants[0].id).toBe("var_1");
    expect(variants[0].sku).toBe("C-50");
    expect(variants[0].ean).toBeUndefined();
    expect(variants[0].weight).toBeUndefined();
  });
});

describe("trimProducts", () => {
  test("trims an array of products", () => {
    const products = [
      { id: "p1", title: "A", noise: true },
      { id: "p2", title: "B", noise: true },
    ];
    const result = trimProducts(
      products as unknown as Record<string, unknown>[],
    );
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("p1");
    expect(result[0].noise).toBeUndefined();
  });

  test("returns empty array for null input", () => {
    expect(trimProducts(null)).toEqual([]);
    expect(trimProducts(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// trimCart
// ---------------------------------------------------------------------------

describe("trimCart", () => {
  test("keeps cart fields and trims items", () => {
    const cart = {
      id: "cart_abc",
      email: "alice@example.com",
      total: 4999,
      subtotal: 4500,
      discount_total: 0,
      shipping_total: 499,
      tax_total: 0,
      currency_code: "usd",
      items: [
        {
          id: "li_1",
          title: "Cleanser",
          quantity: 1,
          unit_price: 4500,
          total: 4500,
          subtotal: 4500,
          variant_id: "var_2",
          product_id: "prod_2",
          product_title: "CeraVe Cleanser",
          variant_title: "200ml",
          thumbnail: "https://example.com/c.jpg",
          variant: { id: "var_2", title: "200ml" },
          // Noise
          raw_unit_price: {},
          tax_lines: [],
          adjustments: [],
        },
      ],
      shipping_address: {
        first_name: "Alice",
        last_name: "Smith",
        address_1: "123 Main St",
        city: "Portland",
        postal_code: "97201",
        country_code: "us",
        company: "ShouldBeDropped",
      },
      shipping_methods: [{ id: "sm_1", name: "Standard" }],
      // Noise
      raw_total: {},
      payment_collection: { id: "pc_1" },
      region_id: "reg_1",
    };

    const result = trimCart(cart as unknown as Record<string, unknown>);
    expect(result!.id).toBe("cart_abc");
    expect(result!.total).toBe(4999);
    expect(result!.raw_total).toBeUndefined();
    expect(result!.payment_collection).toBeUndefined();
    expect(result!.region_id).toBeUndefined();

    const items = result!.items as Record<string, unknown>[];
    expect(items[0].id).toBe("li_1");
    expect(items[0].raw_unit_price).toBeUndefined();
    expect(items[0].tax_lines).toBeUndefined();

    const addr = result!.shipping_address as Record<string, unknown>;
    expect(addr.first_name).toBe("Alice");
    expect(addr.company).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// trimReturn
// ---------------------------------------------------------------------------

describe("trimReturn", () => {
  test("keeps return fields", () => {
    const ret = {
      id: "ret_1",
      order_id: "order_123",
      status: "requested",
      refund_amount: 2999,
      created_at: "2026-01-20T10:00:00Z",
      items: [
        {
          id: "ri_1",
          quantity: 1,
          reason_id: "reason_1",
          note: "Damaged",
          item_id: "item_1",
          internal_ref: "xyz",
        },
      ],
      // Noise
      metadata: {},
      raw_refund_amount: {},
    };

    const result = trimReturn(ret as unknown as Record<string, unknown>);
    expect(result!.id).toBe("ret_1");
    expect(result!.status).toBe("requested");
    expect(result!.metadata).toBeUndefined();
    expect(result!.raw_refund_amount).toBeUndefined();

    const items = result!.items as Record<string, unknown>[];
    expect(items[0].quantity).toBe(1);
    expect(items[0].internal_ref).toBeUndefined();
  });

  test("returns null for null input", () => {
    expect(trimReturn(null)).toBeNull();
  });
});
