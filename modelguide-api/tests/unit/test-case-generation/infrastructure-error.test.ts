/**
 * Unit tests for isInfrastructureError — determines whether an error
 * should abort the entire generation pipeline vs be retried/skipped.
 */

import { describe, expect, test } from "bun:test";
import { isInfrastructureError } from "@features/test-case-generation/service";

describe("isInfrastructureError", () => {
  describe("returns true for infrastructure errors", () => {
    test("Error with status 401", () => {
      const err = Object.assign(new Error("Unauthorized"), { status: 401 });
      expect(isInfrastructureError(err)).toBe(true);
    });

    test("Error with status 403", () => {
      const err = Object.assign(new Error("Forbidden"), { status: 403 });
      expect(isInfrastructureError(err)).toBe(true);
    });

    test("Error with status 429", () => {
      const err = Object.assign(new Error("Too Many Requests"), {
        status: 429,
      });
      expect(isInfrastructureError(err)).toBe(true);
    });

    test("Error message containing 'rate limit'", () => {
      expect(isInfrastructureError(new Error("Rate limit exceeded"))).toBe(
        true,
      );
    });

    test("Error message containing 'econnrefused'", () => {
      expect(
        isInfrastructureError(new Error("connect ECONNREFUSED 127.0.0.1:443")),
      ).toBe(true);
    });

    test("Error message containing 'enotfound'", () => {
      expect(
        isInfrastructureError(
          new Error("getaddrinfo ENOTFOUND api.openai.com"),
        ),
      ).toBe(true);
    });

    test("Error message containing 'authentication'", () => {
      expect(isInfrastructureError(new Error("Authentication failed"))).toBe(
        true,
      );
    });

    test("Error message containing 'unauthorized'", () => {
      expect(isInfrastructureError(new Error("Request unauthorized"))).toBe(
        true,
      );
    });
  });

  describe("returns false for per-case errors (should retry/skip)", () => {
    test("schema validation error", () => {
      expect(isInfrastructureError(new Error("Schema validation failed"))).toBe(
        false,
      );
    });

    test("JSON parse error", () => {
      expect(isInfrastructureError(new Error("Unexpected token in JSON"))).toBe(
        false,
      );
    });

    test("generic LLM content error", () => {
      expect(
        isInfrastructureError(
          new Error("The model produced an invalid response"),
        ),
      ).toBe(false);
    });

    test("Error with status 500 (server error, not auth)", () => {
      const err = Object.assign(new Error("Internal Server Error"), {
        status: 500,
      });
      expect(isInfrastructureError(err)).toBe(false);
    });

    test("Error with status 400 (bad request)", () => {
      const err = Object.assign(new Error("Bad Request"), { status: 400 });
      expect(isInfrastructureError(err)).toBe(false);
    });
  });

  describe("returns false for non-Error values", () => {
    test("string", () => {
      expect(isInfrastructureError("something broke")).toBe(false);
    });

    test("null", () => {
      expect(isInfrastructureError(null)).toBe(false);
    });

    test("undefined", () => {
      expect(isInfrastructureError(undefined)).toBe(false);
    });

    test("plain object", () => {
      expect(isInfrastructureError({ message: "rate limit" })).toBe(false);
    });
  });
});
