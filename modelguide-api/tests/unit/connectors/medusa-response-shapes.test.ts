/**
 * Unit tests for response trimming infrastructure and Medusa shapes.
 */

import { describe, expect, test } from "bun:test";
import { trimToShape } from "@features/connectors/catalog/lib/response-trimmer";
import {
  CART,
  ORDER,
  PRODUCT,
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
        address: { city: "NYC", zip: "10001", internal_ref: "xyz" },
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
          level2: { keep: "yes", drop: "no" },
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
// ORDER shape applied via trimToShape
// ---------------------------------------------------------------------------

describe("ORDER shape", () => {
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
        quantity: 2,
        unit_price: 2999,
        total: 5998,
        shipped_quantity: 2,
        variant: { id: "var_1", title: "50ml" },
        raw_unit_price: { value: "2999", precision: 20 },
        tax_lines: [],
        detail: { id: "detail_1" },
        created_at: "2026-01-15T10:00:00Z",
        metadata: null,
        is_giftcard: false,
      },
    ],
    raw_total: { value: "5999", precision: 20 },
    summary: { pending_difference: 0 },
    version: 3,
    metadata: null,
    updated_at: "2026-01-15T10:01:00Z",
  };

  test("strips noise fields from order", () => {
    const result = trimToShape(fullOrder as Record<string, unknown>, ORDER);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("order_123");
    expect(result!.display_id).toBe(1042);
    expect(result!.fulfillment_status).toBe("shipped");
    expect(result!.raw_total).toBeUndefined();
    expect(result!.summary).toBeUndefined();
    expect(result!.version).toBeUndefined();
    expect(result!.metadata).toBeUndefined();
  });

  test("strips noise fields from order items", () => {
    const result = trimToShape(fullOrder as Record<string, unknown>, ORDER);
    const items = result!.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("item_1");
    expect(items[0].shipped_quantity).toBe(2);
    expect(items[0].variant).toEqual({ id: "var_1", title: "50ml" });
    expect(items[0].raw_unit_price).toBeUndefined();
    expect(items[0].tax_lines).toBeUndefined();
    expect(items[0].detail).toBeUndefined();
    expect(items[0].metadata).toBeUndefined();
    expect(items[0].is_giftcard).toBeUndefined();
  });

  test("trims shipping_address to allowed fields", () => {
    const result = trimToShape(fullOrder as Record<string, unknown>, ORDER);
    const addr = result!.shipping_address as Record<string, unknown>;
    expect(addr.first_name).toBe("Alice");
    expect(addr.city).toBe("Portland");
    expect(addr.company).toBeUndefined();
    expect(addr.province).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PRODUCT shape
// ---------------------------------------------------------------------------

describe("PRODUCT shape", () => {
  test("keeps product fields and trims variant internals", () => {
    const product = {
      id: "prod_1",
      title: "CeraVe",
      description: "Hydrating",
      handle: "cerave",
      status: "published",
      thumbnail: "https://example.com/t.jpg",
      variants: [
        {
          id: "var_1",
          title: "50ml",
          sku: "C-50",
          prices: [{ amount: 1999, currency_code: "usd" }],
          inventory_quantity: 42,
          ean: "1234567890",
          weight: 100,
        },
      ],
      raw_metadata: {},
      type_id: "type_1",
    };

    const result = trimToShape(
      product as unknown as Record<string, unknown>,
      PRODUCT,
    );
    expect(result!.id).toBe("prod_1");
    expect(result!.raw_metadata).toBeUndefined();
    expect(result!.type_id).toBeUndefined();

    const variants = result!.variants as Record<string, unknown>[];
    expect(variants[0].sku).toBe("C-50");
    expect(variants[0].ean).toBeUndefined();
    expect(variants[0].weight).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CART shape
// ---------------------------------------------------------------------------

describe("CART shape", () => {
  test("keeps cart fields and strips noise from items", () => {
    const cart = {
      id: "cart_abc",
      email: "alice@example.com",
      total: 4999,
      subtotal: 4500,
      currency_code: "usd",
      items: [
        {
          id: "li_1",
          title: "Cleanser",
          quantity: 1,
          unit_price: 4500,
          total: 4500,
          variant: { id: "var_2", title: "200ml" },
          raw_unit_price: {},
          tax_lines: [],
        },
      ],
      shipping_address: {
        first_name: "Alice",
        city: "Portland",
        company: "ShouldBeDropped",
      },
      raw_total: {},
      payment_collection: { id: "pc_1" },
    };

    const result = trimToShape(
      cart as unknown as Record<string, unknown>,
      CART,
    );
    expect(result!.id).toBe("cart_abc");
    expect(result!.total).toBe(4999);
    expect(result!.raw_total).toBeUndefined();
    expect(result!.payment_collection).toBeUndefined();

    const items = result!.items as Record<string, unknown>[];
    expect(items[0].raw_unit_price).toBeUndefined();

    const addr = result!.shipping_address as Record<string, unknown>;
    expect(addr.first_name).toBe("Alice");
    expect(addr.company).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Manifest integration — responseShape declared on tools
// ---------------------------------------------------------------------------

describe("Medusa manifest responseShape", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const medusaManifest =
    require("@features/connectors/catalog/medusa/index").default;

  const toolsWithShape = [
    "List Products",
    "Get Product",
    "Create Cart",
    "Add to Cart",
    "Get Cart",
    "Set Delivery Address",
    "Complete Cart",
    "Get Order",
    "Look Up Order",
    "Look Up Order History",
  ];

  for (const name of toolsWithShape) {
    test(`${name} has a responseShape`, () => {
      const tool = medusaManifest.tools.find(
        (t: { catalog: { name: string } }) => t.catalog.name === name,
      );
      expect(tool).toBeDefined();
      expect(tool.responseShape).toBeDefined();
      expect(typeof tool.responseShape).toBe("object");
    });
  }
});
