/**
 * Unit tests for phone normalization (#66)
 */

import { describe, expect, test } from "bun:test";
import { normalizePhone } from "@features/sessions";

describe("normalizePhone", () => {
  test("strips dashes and spaces", () => {
    expect(normalizePhone("+1-555-123-4567")).toBe("+15551234567");
  });

  test("strips parentheses", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
  });

  test("preserves leading +", () => {
    expect(normalizePhone("+441234567890")).toBe("+441234567890");
  });

  test("strips non-digit chars from number without +", () => {
    expect(normalizePhone("555.123.4567")).toBe("5551234567");
  });

  test("handles already-clean number", () => {
    expect(normalizePhone("15551234567")).toBe("15551234567");
  });

  test("handles already-clean number with +", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
  });
});
