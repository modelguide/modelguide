/**
 * Unit tests for JSON Schema → Zod conversion utility
 */

import { describe, expect, test } from "bun:test";
import { jsonSchemaToZod } from "@features/mcp/schema-utils";

describe("jsonSchemaToZod", () => {
  test("converts string property", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });

    expect(shape.name).toBeDefined();
    const result = shape.name.safeParse("hello");
    expect(result.success).toBe(true);

    const fail = shape.name.safeParse(42);
    expect(fail.success).toBe(false);
  });

  test("converts number property", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
    });

    expect(shape.count.safeParse(42).success).toBe(true);
    expect(shape.count.safeParse("nope").success).toBe(false);
  });

  test("converts integer as number", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { age: { type: "integer" } },
      required: ["age"],
    });

    expect(shape.age.safeParse(25).success).toBe(true);
    expect(shape.age.safeParse("old").success).toBe(false);
  });

  test("converts boolean property", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: { active: { type: "boolean" } },
      required: ["active"],
    });

    expect(shape.active.safeParse(true).success).toBe(true);
    expect(shape.active.safeParse("true").success).toBe(false);
  });

  test("marks non-required properties as optional", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["name"],
    });

    // name is required
    expect(shape.name.safeParse(undefined).success).toBe(false);

    // nickname is optional (accepts undefined)
    expect(shape.nickname.safeParse(undefined).success).toBe(true);
    expect(shape.nickname.safeParse("nick").success).toBe(true);
  });

  test("converts array of strings", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["tags"],
    });

    expect(shape.tags.safeParse(["a", "b"]).success).toBe(true);
    expect(shape.tags.safeParse([1, 2]).success).toBe(false);
    expect(shape.tags.safeParse("not array").success).toBe(false);
  });

  test("converts array without items spec as z.array(z.any())", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        data: { type: "array" },
      },
      required: ["data"],
    });

    expect(shape.data.safeParse([1, "two", true]).success).toBe(true);
  });

  test("converts nested object", () => {
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

    // Missing required nested field
    expect(shape.address.safeParse({ zip: "12345" }).success).toBe(false);
  });

  test("converts object without properties as z.record(z.any())", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        metadata: { type: "object" },
      },
      required: ["metadata"],
    });

    expect(shape.metadata.safeParse({ any: "thing" }).success).toBe(true);
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
      properties: {
        mystery: { type: "unknown_type" },
      },
      required: ["mystery"],
    });

    expect(shape.mystery.safeParse("anything").success).toBe(true);
    expect(shape.mystery.safeParse(42).success).toBe(true);
    expect(shape.mystery.safeParse(null).success).toBe(true);
  });

  test("returns empty shape for schema with no properties", () => {
    const shape = jsonSchemaToZod({});
    expect(Object.keys(shape)).toEqual([]);
  });

  test("returns empty shape for schema with empty properties", () => {
    const shape = jsonSchemaToZod({ type: "object", properties: {} });
    expect(Object.keys(shape)).toEqual([]);
  });

  test("handles missing required array (all optional)", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    });

    // Both should be optional
    expect(shape.a.safeParse(undefined).success).toBe(true);
    expect(shape.b.safeParse(undefined).success).toBe(true);
  });

  test("handles array of objects", () => {
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

  test("handles complex real-world schema (Medusa-like)", () => {
    const shape = jsonSchemaToZod({
      type: "object",
      properties: {
        cart_id: { type: "string", description: "Cart ID" },
        variant_id: { type: "string", description: "Product variant ID" },
        quantity: { type: "integer", description: "Quantity to add" },
        metadata: {
          type: "object",
          description: "Additional metadata",
        },
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

    // metadata is optional
    expect(shape.metadata.safeParse(undefined).success).toBe(true);
  });
});
