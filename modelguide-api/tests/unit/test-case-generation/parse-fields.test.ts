/**
 * Unit tests for parseFields — converts LLM key-value string pairs
 * to typed ToolStateVariant records.
 */

import { describe, expect, test } from "bun:test";
import { parseFields } from "@features/test-case-generation/parse-fields";

describe("parseFields", () => {
  test("converts 'true' and 'false' strings to booleans", () => {
    const result = parseFields([
      { key: "error", value: "true" },
      { key: "eligible", value: "false" },
    ]);
    expect(result.error).toBe(true);
    expect(result.eligible).toBe(false);
  });

  test("converts numeric strings to numbers", () => {
    const result = parseFields([
      { key: "count", value: "42" },
      { key: "price", value: "3.14" },
      { key: "zero", value: "0" },
      { key: "negative", value: "-5" },
    ]);
    expect(result.count).toBe(42);
    expect(result.price).toBe(3.14);
    expect(result.zero).toBe(0);
    expect(result.negative).toBe(-5);
  });

  test("keeps non-numeric strings as strings", () => {
    const result = parseFields([
      { key: "status", value: "delivered" },
      { key: "tracking", value: "1Z999" },
      { key: "message", value: "Order not found" },
    ]);
    expect(result.status).toBe("delivered");
    expect(result.tracking).toBe("1Z999");
    expect(result.message).toBe("Order not found");
  });

  test("keeps empty string as string (not converted to 0)", () => {
    const result = parseFields([{ key: "notes", value: "" }]);
    expect(result.notes).toBe("");
  });

  test("keeps NaN-producing strings as strings", () => {
    const result = parseFields([
      { key: "label", value: "NaN" },
      { key: "name", value: "abc123" },
    ]);
    expect(result.label).toBe("NaN");
    expect(result.name).toBe("abc123");
  });

  test("returns empty record for empty input", () => {
    const result = parseFields([]);
    expect(result).toEqual({});
  });

  test("later entries overwrite earlier ones with the same key", () => {
    const result = parseFields([
      { key: "status", value: "pending" },
      { key: "status", value: "shipped" },
    ]);
    expect(result.status).toBe("shipped");
  });
});
