/**
 * Unit tests for the generic response trimmer utility.
 * Medusa-specific shape tests live in medusa-response-shapes.test.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  type ResponseShape,
  trimToShape,
} from "@features/connectors/catalog/lib/response-trimmer";

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

  test("returns null for null input", () => {
    expect(trimToShape(null, { id: true })).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(trimToShape(undefined, { id: true })).toBeNull();
  });

  test("preserves primitive arrays when spec is true", () => {
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

  test("returns empty object when no keys match", () => {
    const result = trimToShape({ a: 1, b: 2 }, { x: true, y: true });
    expect(result).toEqual({});
  });

  test("preserves falsy values (0, false, empty string)", () => {
    const result = trimToShape(
      { count: 0, active: false, label: "" },
      { count: true, active: true, label: true },
    );
    expect(result).toEqual({ count: 0, active: false, label: "" });
  });

  test("handles mixed arrays (primitives ignored by nested shape)", () => {
    const result = trimToShape(
      { items: [null, 42, "str", { id: "a", noise: "x" }] },
      { items: { id: true } },
    );
    expect(result).toEqual({
      items: [null, 42, "str", { id: "a" }],
    });
  });

  test("handles empty arrays", () => {
    const result = trimToShape({ items: [] }, { items: { id: true } });
    expect(result).toEqual({ items: [] });
  });

  test("handles empty nested objects", () => {
    const result = trimToShape({ meta: {} }, { meta: { key: true } });
    expect(result).toEqual({ meta: {} });
  });

  test("works with empty shape (strips everything)", () => {
    const shape: ResponseShape = {};
    const result = trimToShape({ id: "1", name: "Alice" }, shape);
    expect(result).toEqual({});
  });
});
