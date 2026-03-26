/**
 * Unit tests for Medusa-specific response shapes (ORDER, PRODUCT, CART).
 * Generic trimToShape tests live in response-trimmer.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { trimToShape } from "@features/connectors/catalog/lib/response-trimmer";
import {
  CART,
  ORDER,
  PRODUCT,
} from "@features/connectors/catalog/medusa/response-shapes";

// ---------------------------------------------------------------------------
// ORDER shape
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
      metadata: { conflict_categories: ["retinol"], skin_type: "oily" },
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
    expect(result!.metadata).toEqual({
      conflict_categories: ["retinol"],
      skin_type: "oily",
    });
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
