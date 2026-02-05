/**
 * Tests for magic link utilities
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
  buildMagicLinkUrl,
  createMagicLink,
  isMagicTokenExpired,
  isMagicTokenUsed,
} from "@lib/magic-link";

// Mock env for tests
beforeAll(() => {
  // Set env vars for magic link tests
  process.env.APP_URL = "http://localhost:3000";
  process.env.MAGIC_LINK_EXPIRES_IN_MINUTES = "15";
});

describe("createMagicLink", () => {
  test("generates token with correct structure", () => {
    const result = createMagicLink();
    expect(result.token).toBeDefined();
    expect(result.token.length).toBeGreaterThan(20);
  });

  test("generates token hash", () => {
    const result = createMagicLink();
    expect(result.tokenHash).toBeDefined();
    expect(result.tokenHash.length).toBe(64); // SHA-256 hex
  });

  test("generates valid link URL", () => {
    const result = createMagicLink();
    expect(result.link).toContain(
      "http://localhost:3000/api/auth/verify?token=",
    );
    expect(result.link).toContain(encodeURIComponent(result.token));
  });

  test("sets expiration in future", () => {
    const result = createMagicLink();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("generates different tokens each time", () => {
    const result1 = createMagicLink();
    const result2 = createMagicLink();
    expect(result1.token).not.toBe(result2.token);
    expect(result1.tokenHash).not.toBe(result2.tokenHash);
  });
});

describe("buildMagicLinkUrl", () => {
  test("builds correct URL with token", () => {
    const url = buildMagicLinkUrl("test-token-123");
    expect(url).toBe(
      "http://localhost:3000/api/auth/verify?token=test-token-123",
    );
  });

  test("encodes special characters in token", () => {
    const url = buildMagicLinkUrl("token+with/special=chars");
    expect(url).toContain(encodeURIComponent("token+with/special=chars"));
  });

  test("handles trailing slash in APP_URL", () => {
    const originalUrl = process.env.APP_URL;
    process.env.APP_URL = "http://localhost:3000/";

    const url = buildMagicLinkUrl("test-token");
    expect(url).toBe("http://localhost:3000/api/auth/verify?token=test-token");

    process.env.APP_URL = originalUrl;
  });
});

describe("isMagicTokenExpired", () => {
  test("returns false for future date", () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes from now
    expect(isMagicTokenExpired(futureDate)).toBe(false);
  });

  test("returns true for past date", () => {
    const pastDate = new Date(Date.now() - 1000 * 60); // 1 minute ago
    expect(isMagicTokenExpired(pastDate)).toBe(true);
  });

  test("returns true for past time (1 second ago)", () => {
    const past = new Date(Date.now() - 1000);
    const result = isMagicTokenExpired(past);
    expect(result).toBe(true);
  });
});

describe("isMagicTokenUsed", () => {
  test("returns false for null", () => {
    expect(isMagicTokenUsed(null)).toBe(false);
  });

  test("returns true for any date", () => {
    expect(isMagicTokenUsed(new Date())).toBe(true);
    expect(isMagicTokenUsed(new Date(Date.now() - 1000))).toBe(true);
  });
});
