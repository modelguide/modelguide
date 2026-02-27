import { describe, expect, test } from "bun:test";
import { stableStringify } from "@lib/json";

describe("stableStringify", () => {
  // -- Primitives --

  test("string", () => {
    expect(stableStringify("hello")).toBe('"hello"');
  });

  test("number", () => {
    expect(stableStringify(42)).toBe("42");
  });

  test("boolean", () => {
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(false)).toBe("false");
  });

  // -- Objects --

  test("empty object", () => {
    expect(stableStringify({})).toBe("{}");
  });

  test("flat object with sorted keys", () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  test("nested objects with sorted keys at every depth", () => {
    const obj = { z: { b: 2, a: 1 }, a: 0 };
    expect(stableStringify(obj)).toBe('{"a":0,"z":{"a":1,"b":2}}');
  });

  test("different key order produces identical output", () => {
    const a = { b: 1, a: 2, c: { z: 3, y: 4 } };
    const b = { a: 2, c: { y: 4, z: 3 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  // -- Arrays --

  test("empty array", () => {
    expect(stableStringify([])).toBe("[]");
  });

  test("array of primitives preserves order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  test("array of objects with sorted keys", () => {
    const arr = [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ];
    expect(stableStringify(arr)).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });

  test("nested arrays", () => {
    expect(stableStringify([[1, 2], [3]])).toBe("[[1,2],[3]]");
  });

  // -- Mixed nesting --

  test("object containing arrays", () => {
    const obj = { tags: ["b", "a"], name: "test" };
    expect(stableStringify(obj)).toBe('{"name":"test","tags":["b","a"]}');
  });

  test("deeply nested mixed structure", () => {
    const obj = {
      z: [{ b: 1, a: 2 }],
      a: { y: [3, 4], x: "hi" },
    };
    expect(stableStringify(obj)).toBe(
      '{"a":{"x":"hi","y":[3,4]},"z":[{"a":2,"b":1}]}',
    );
  });

  // -- Edge cases --

  test("object with null value", () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });

  test("object with string containing special characters", () => {
    expect(stableStringify({ a: 'he said "hi"' })).toBe(
      '{"a":"he said \\"hi\\""}',
    );
  });

  test("JSON Schema–shaped object (realistic input)", () => {
    const schema = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Product ID" },
        qty: { type: "number" },
      },
    };
    const reordered = {
      properties: {
        qty: { type: "number" },
        id: { description: "Product ID", type: "string" },
      },
      required: ["id"],
      type: "object",
    };
    expect(stableStringify(schema)).toBe(stableStringify(reordered));
  });

  // -- Inequality: values that must NOT compare equal --

  test("different values for same key", () => {
    expect(stableStringify({ a: 5 })).not.toBe(stableStringify({ b: 5 }));
  });

  test("same keys, different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  test("extra key makes objects unequal", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: 2 }));
  });

  test("null vs 0 vs false vs empty string", () => {
    const results = [
      stableStringify({ v: null }),
      stableStringify({ v: 0 }),
      stableStringify({ v: false }),
      stableStringify({ v: "" }),
    ];
    const unique = new Set(results);
    expect(unique.size).toBe(results.length);
  });

  test("array order matters", () => {
    expect(stableStringify({ a: [1, 2] })).not.toBe(
      stableStringify({ a: [2, 1] }),
    );
  });

  test("nested value difference detected", () => {
    const a = { x: { y: { z: 1 } } };
    const b = { x: { y: { z: 2 } } };
    expect(stableStringify(a)).not.toBe(stableStringify(b));
  });

  test("string '1' vs number 1", () => {
    expect(stableStringify({ a: "1" })).not.toBe(stableStringify({ a: 1 }));
  });
});
