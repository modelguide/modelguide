/**
 * Unit tests for JSON Schema → Zod conversion utility.
 * Focuses on our conversion logic (required/optional, nesting, edge cases)
 * rather than testing Zod primitive validation.
 */

import { describe, expect, test } from "bun:test";
import { jsonSchemaToZod } from "@features/mcp/schema-utils";

describe("jsonSchemaToZod", () => {
  test("marks required properties as required and others as optional", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["name"],
    });

    expect(shape.name.safeParse(undefined).success).toBe(false);
    expect(shape.nickname.safeParse(undefined).success).toBe(true);
  });

  test("handles missing required array (all optional)", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    });

    expect(shape.a.safeParse(undefined).success).toBe(true);
    expect(shape.b.safeParse(undefined).success).toBe(true);
  });

  test("converts nested object with inner required fields", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            zip: { type: "string" },
          },
          required: ["street"],
        },
      },
      required: ["address"],
    });

    expect(shape.address.safeParse({ street: "123 Main St" }).success).toBe(
      true,
    );
    expect(shape.address.safeParse({ zip: "12345" }).success).toBe(false);
  });

  test("converts object without properties as z.record(z.any())", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { metadata: { type: "object" } },
      required: ["metadata"],
    });

    expect(shape.metadata.safeParse({ any: "thing" }).success).toBe(true);
  });

  test("converts array without items spec as z.array(z.any())", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { data: { type: "array" } },
      required: ["data"],
    });

    expect(shape.data.safeParse([1, "two", true]).success).toBe(true);
  });

  test("converts array of objects with nested required", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              qty: { type: "number" },
            },
            required: ["id"],
          },
        },
      },
      required: ["items"],
    });

    expect(shape.items.safeParse([{ id: "abc", qty: 2 }]).success).toBe(true);
    expect(shape.items.safeParse([{ qty: 2 }]).success).toBe(false);
  });

  test("preserves description on schema", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        email: { type: "string", description: "User email address" },
      },
      required: ["email"],
    });

    expect(shape.email.description).toBe("User email address");
  });

  test("falls back to z.any() for unknown type", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { mystery: { type: "unknown_type" } },
      required: ["mystery"],
    });

    expect(shape.mystery.safeParse("anything").success).toBe(true);
    expect(shape.mystery.safeParse(42).success).toBe(true);
    expect(shape.mystery.safeParse(null).success).toBe(true);
  });

  test("returns empty shape for schema with no properties", () => {
    expect(Object.keys(jsonSchemaToZod({}))).toEqual([]);
  });

  test("returns empty shape for schema with empty properties", () => {
    expect(
      Object.keys(jsonSchemaToZod({ type: "object", properties: {} })),
    ).toEqual([]);
  });

  test("handles complex real-world schema (Medusa-like)", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        cart_id: { type: "string", description: "Cart ID" },
        variant_id: { type: "string", description: "Product variant ID" },
        quantity: { type: "integer", description: "Quantity to add" },
        metadata: { type: "object", description: "Additional metadata" },
      },
      required: ["cart_id", "variant_id", "quantity"],
    });

    expect(Object.keys(shape)).toEqual([
      "cart_id",
      "variant_id",
      "quantity",
      "metadata",
    ]);
    expect(shape.cart_id.safeParse("cart_123").success).toBe(true);
    expect(shape.metadata.safeParse(undefined).success).toBe(true);
  });
});
