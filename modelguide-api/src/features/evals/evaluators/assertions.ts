/**
 * Assertion runner for evaluating tool input fields.
 *
 * Includes safeRegexTest() for the `matches` operator — prevents ReDoS
 * via pattern length limits and execution timeout.
 */

import type { Assertion } from "../evals.types";

/** Maximum allowed regex pattern length. */
const MAX_REGEX_LENGTH = 200;

/** Timeout for regex execution in milliseconds. */
const REGEX_TIMEOUT_MS = 5;

/**
 * Patterns that indicate potentially catastrophic regex backtracking.
 * Detects nested quantifiers like (a+)+, (a*)+, (.+)*, etc.
 */
const DANGEROUS_REGEX_PATTERN = /(\([^)]*[+*][^)]*\))[+*]|\(\?[^)]*\)\{/;

export interface AssertionResult {
  passed: boolean;
  errored?: boolean;
  expected: unknown;
  actual: unknown;
  message: string;
}

/**
 * Test a value against a regex pattern safely.
 * Returns null if the pattern is invalid or dangerous.
 */
export function safeRegexTest(
  pattern: string,
  value: string,
): { matched: boolean } | { error: string } {
  if (pattern.length > MAX_REGEX_LENGTH) {
    return {
      error: `Regex pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters`,
    };
  }

  if (DANGEROUS_REGEX_PATTERN.test(pattern)) {
    return {
      error:
        "Regex pattern contains potentially dangerous constructs (nested quantifiers)",
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { error: `Invalid regex pattern: ${pattern}` };
  }

  // Execute with timeout protection
  const start = performance.now();
  const matched = regex.test(value);
  const elapsed = performance.now() - start;

  if (elapsed > REGEX_TIMEOUT_MS) {
    return {
      error: `Regex execution exceeded ${REGEX_TIMEOUT_MS}ms timeout (took ${Math.round(elapsed)}ms)`,
    };
  }

  return { matched };
}

/**
 * Run a single assertion against a value.
 */
export function runAssertion(
  field: string,
  assertion: Assertion,
  actual: unknown,
): AssertionResult {
  const { op, value: expected } = assertion;

  switch (op) {
    case "exists":
      return {
        passed: actual !== undefined && actual !== null,
        expected: "field exists",
        actual: actual === undefined ? "undefined" : actual,
        message:
          actual !== undefined && actual !== null
            ? `Field "${field}" exists`
            : `Field "${field}" does not exist`,
      };

    case "equals": {
      // Use string coercion so "123" matches 123, etc.
      const isEqual =
        actual === expected || String(actual) === String(expected);
      return {
        passed: isEqual,
        expected,
        actual,
        message: isEqual
          ? `Field "${field}" equals expected value`
          : `Field "${field}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      };
    }

    case "contains": {
      const strActual = String(actual ?? "");
      const strExpected = String(expected ?? "");
      const contains = strActual.includes(strExpected);
      return {
        passed: contains,
        expected: `contains "${strExpected}"`,
        actual: strActual,
        message: contains
          ? `Field "${field}" contains "${strExpected}"`
          : `Field "${field}" does not contain "${strExpected}"`,
      };
    }

    case "gt": {
      const numActual = Number(actual);
      const numExpected = Number(expected);
      const passed = !Number.isNaN(numActual) && numActual > numExpected;
      return {
        passed,
        expected: `> ${numExpected}`,
        actual: numActual,
        message: passed
          ? `Field "${field}": ${numActual} > ${numExpected}`
          : `Field "${field}": expected > ${numExpected}, got ${numActual}`,
      };
    }

    case "lt": {
      const numActual = Number(actual);
      const numExpected = Number(expected);
      const passed = !Number.isNaN(numActual) && numActual < numExpected;
      return {
        passed,
        expected: `< ${numExpected}`,
        actual: numActual,
        message: passed
          ? `Field "${field}": ${numActual} < ${numExpected}`
          : `Field "${field}": expected < ${numExpected}, got ${numActual}`,
      };
    }

    case "matches": {
      const strActual = String(actual ?? "");
      const strExpected = String(expected ?? "");
      const result = safeRegexTest(strExpected, strActual);

      if ("error" in result) {
        return {
          passed: false,
          errored: true,
          expected: `matches /${strExpected}/`,
          actual: result.error,
          message: `Field "${field}": regex error — ${result.error}`,
        };
      }

      return {
        passed: result.matched,
        expected: `matches /${strExpected}/`,
        actual: strActual,
        message: result.matched
          ? `Field "${field}" matches pattern /${strExpected}/`
          : `Field "${field}" does not match pattern /${strExpected}/`,
      };
    }
  }
}
