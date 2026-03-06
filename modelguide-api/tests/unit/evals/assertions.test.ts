/**
 * Unit tests for assertion runner and safe regex testing.
 */

import { describe, expect, test } from "bun:test";
import {
  runAssertion,
  safeRegexTest,
} from "@features/evals/evaluators/assertions";

// ============================================================================
// safeRegexTest
// ============================================================================

describe("safeRegexTest", () => {
  test("matches a simple pattern", () => {
    const result = safeRegexTest("^hello", "hello world");
    expect(result).toEqual({ matched: true });
  });

  test("returns false for non-matching pattern", () => {
    const result = safeRegexTest("^world", "hello world");
    expect(result).toEqual({ matched: false });
  });

  test("rejects pattern exceeding max length", () => {
    const longPattern = "a".repeat(201);
    const result = safeRegexTest(longPattern, "aaa");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("maximum length");
    }
  });

  test("accepts pattern at exactly max length", () => {
    const pattern = "a".repeat(200);
    const result = safeRegexTest(pattern, "a".repeat(200));
    expect("matched" in result).toBe(true);
  });

  test("rejects dangerous nested quantifier (a+)+", () => {
    const result = safeRegexTest("(a+)+", "aaa");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("dangerous");
    }
  });

  test("rejects dangerous nested quantifier (.*)*", () => {
    const result = safeRegexTest("(.*)*", "aaa");
    expect("error" in result).toBe(true);
  });

  test("returns error for invalid regex syntax", () => {
    const result = safeRegexTest("[invalid", "test");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Invalid regex");
    }
  });

  test("handles case-sensitive matching", () => {
    const result = safeRegexTest("^Hello$", "hello");
    expect(result).toEqual({ matched: false });
  });

  test("handles special regex characters", () => {
    const result = safeRegexTest("\\d{3}-\\d{4}", "555-1234");
    expect(result).toEqual({ matched: true });
  });
});

// ============================================================================
// runAssertion — exists
// ============================================================================

describe("runAssertion: exists", () => {
  test("passes when field has a value", () => {
    const result = runAssertion("name", { op: "exists" }, "Alice");
    expect(result.passed).toBe(true);
  });

  test("passes for falsy non-null values", () => {
    expect(runAssertion("count", { op: "exists" }, 0).passed).toBe(true);
    expect(runAssertion("flag", { op: "exists" }, false).passed).toBe(true);
    expect(runAssertion("str", { op: "exists" }, "").passed).toBe(true);
  });

  test("fails when field is undefined", () => {
    const result = runAssertion("name", { op: "exists" }, undefined);
    expect(result.passed).toBe(false);
  });

  test("fails when field is null", () => {
    const result = runAssertion("name", { op: "exists" }, null);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// runAssertion — equals
// ============================================================================

describe("runAssertion: equals", () => {
  test("passes for exact string match", () => {
    const result = runAssertion("id", { op: "equals", value: "abc" }, "abc");
    expect(result.passed).toBe(true);
  });

  test("fails for different strings", () => {
    const result = runAssertion("id", { op: "equals", value: "abc" }, "xyz");
    expect(result.passed).toBe(false);
  });

  test("passes with type coercion (string vs number)", () => {
    const result = runAssertion("qty", { op: "equals", value: 123 }, "123");
    expect(result.passed).toBe(true);
  });

  test("passes for exact number match", () => {
    const result = runAssertion("qty", { op: "equals", value: 42 }, 42);
    expect(result.passed).toBe(true);
  });

  test("passes for boolean match", () => {
    const result = runAssertion("flag", { op: "equals", value: true }, true);
    expect(result.passed).toBe(true);
  });

  test("includes expected and actual in result", () => {
    const result = runAssertion("id", { op: "equals", value: "abc" }, "xyz");
    expect(result.expected).toBe("abc");
    expect(result.actual).toBe("xyz");
  });
});

// ============================================================================
// runAssertion — contains
// ============================================================================

describe("runAssertion: contains", () => {
  test("passes when string contains substring", () => {
    const result = runAssertion(
      "msg",
      { op: "contains", value: "world" },
      "hello world",
    );
    expect(result.passed).toBe(true);
  });

  test("fails when string does not contain substring", () => {
    const result = runAssertion(
      "msg",
      { op: "contains", value: "xyz" },
      "hello world",
    );
    expect(result.passed).toBe(false);
  });

  test("coerces non-string actual to string", () => {
    const result = runAssertion("qty", { op: "contains", value: "42" }, 42);
    expect(result.passed).toBe(true);
  });

  test("handles null actual gracefully", () => {
    const result = runAssertion("msg", { op: "contains", value: "test" }, null);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// runAssertion — gt / lt
// ============================================================================

describe("runAssertion: gt", () => {
  test("passes when actual > expected", () => {
    const result = runAssertion("qty", { op: "gt", value: 5 }, 10);
    expect(result.passed).toBe(true);
  });

  test("fails when actual === expected", () => {
    const result = runAssertion("qty", { op: "gt", value: 5 }, 5);
    expect(result.passed).toBe(false);
  });

  test("fails when actual < expected", () => {
    const result = runAssertion("qty", { op: "gt", value: 5 }, 3);
    expect(result.passed).toBe(false);
  });

  test("fails for non-numeric actual", () => {
    const result = runAssertion("qty", { op: "gt", value: 5 }, "abc");
    expect(result.passed).toBe(false);
  });

  test("coerces numeric strings", () => {
    const result = runAssertion("qty", { op: "gt", value: 5 }, "10");
    expect(result.passed).toBe(true);
  });
});

describe("runAssertion: lt", () => {
  test("passes when actual < expected", () => {
    const result = runAssertion("qty", { op: "lt", value: 10 }, 5);
    expect(result.passed).toBe(true);
  });

  test("fails when actual === expected", () => {
    const result = runAssertion("qty", { op: "lt", value: 5 }, 5);
    expect(result.passed).toBe(false);
  });

  test("fails when actual > expected", () => {
    const result = runAssertion("qty", { op: "lt", value: 5 }, 10);
    expect(result.passed).toBe(false);
  });
});

// ============================================================================
// runAssertion — matches
// ============================================================================

describe("runAssertion: matches", () => {
  test("passes when value matches regex", () => {
    const result = runAssertion(
      "email",
      { op: "matches", value: "^.+@.+\\..+$" },
      "test@example.com",
    );
    expect(result.passed).toBe(true);
  });

  test("fails when value does not match regex", () => {
    const result = runAssertion(
      "email",
      { op: "matches", value: "^\\d+$" },
      "not-a-number",
    );
    expect(result.passed).toBe(false);
  });

  test("fails with error message for invalid regex", () => {
    const result = runAssertion(
      "field",
      { op: "matches", value: "[invalid" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(String(result.actual)).toContain("Invalid regex");
  });

  test("fails with error for dangerous pattern", () => {
    const result = runAssertion(
      "field",
      { op: "matches", value: "(a+)+" },
      "test",
    );
    expect(result.passed).toBe(false);
    expect(String(result.actual)).toContain("dangerous");
  });
});
