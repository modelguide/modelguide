/**
 * Tests for crypto utilities
 */

import { describe, expect, test } from "bun:test";
import {
  generateApiKey,
  generateMagicToken,
  hashApiKey,
  hashMagicToken,
  isValidApiKeyFormat,
} from "@lib/crypto";

// Note: encryptSecret/decryptSecret require ENCRYPTION_KEY env var
// Those are tested in integration tests

describe("generateApiKey", () => {
  test("generates key with correct prefix", () => {
    const { key } = generateApiKey();
    expect(key.startsWith("mgk_")).toBe(true);
  });

  test("generates key with correct length", () => {
    const { key } = generateApiKey();
    // mgk_ (4 chars) + 32 chars random = 36 chars
    expect(key.length).toBe(36);
  });

  test("generates different keys each time", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.key).not.toBe(key2.key);
    expect(key1.hash).not.toBe(key2.hash);
  });

  test("generates hash that is 64 chars (SHA-256 hex)", () => {
    const { hash } = generateApiKey();
    expect(hash.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });

  test("generates prefix with correct format", () => {
    const { key, prefix } = generateApiKey();
    expect(prefix.startsWith("mgk_")).toBe(true);
    expect(prefix.length).toBe(8); // mgk_ + 4 chars
    expect(key.startsWith(prefix)).toBe(true);
  });
});

describe("hashApiKey", () => {
  test("produces consistent hash for same input", () => {
    const key = "mgk_testkey12345678901234567890ab";
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  test("produces different hash for different input", () => {
    const hash1 = hashApiKey("mgk_testkey12345678901234567890ab");
    const hash2 = hashApiKey("mgk_testkey12345678901234567890cd");
    expect(hash1).not.toBe(hash2);
  });

  test("hash length is 64 chars (SHA-256 hex)", () => {
    const hash = hashApiKey("mgk_testkey12345678901234567890ab");
    expect(hash.length).toBe(64);
  });
});

describe("isValidApiKeyFormat", () => {
  test("accepts valid API key format", () => {
    const { key } = generateApiKey();
    expect(isValidApiKeyFormat(key)).toBe(true);
  });

  test("rejects key without mgk_ prefix", () => {
    expect(isValidApiKeyFormat("abc_testkey12345678901234567890ab")).toBe(
      false,
    );
    expect(isValidApiKeyFormat("testkey12345678901234567890abcdef")).toBe(
      false,
    );
  });

  test("rejects key with wrong length", () => {
    expect(isValidApiKeyFormat("mgk_short")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidApiKeyFormat("")).toBe(false);
  });

  test("allows slight variations in length due to base64", () => {
    // Base64url encoding can have slight length variations
    expect(isValidApiKeyFormat("mgk_12345678901234567890123456789012")).toBe(
      true,
    );
    expect(isValidApiKeyFormat("mgk_1234567890123456789012345678901")).toBe(
      true,
    );
  });
});

describe("generateMagicToken", () => {
  test("generates token of appropriate length", () => {
    const token = generateMagicToken();
    // Should be around 43 chars (32 bytes in base64url)
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(token.length).toBeLessThanOrEqual(50);
  });

  test("generates different tokens each time", () => {
    const token1 = generateMagicToken();
    const token2 = generateMagicToken();
    expect(token1).not.toBe(token2);
  });

  test("generates URL-safe characters", () => {
    const token = generateMagicToken();
    // Base64url should not contain +, /, or =
    expect(token.includes("+")).toBe(false);
    expect(token.includes("/")).toBe(false);
  });
});

describe("hashMagicToken", () => {
  test("produces consistent hash for same input", () => {
    const token = "test-magic-token";
    const hash1 = hashMagicToken(token);
    const hash2 = hashMagicToken(token);
    expect(hash1).toBe(hash2);
  });

  test("produces different hash for different input", () => {
    const hash1 = hashMagicToken("token1");
    const hash2 = hashMagicToken("token2");
    expect(hash1).not.toBe(hash2);
  });

  test("hash length is 64 chars (SHA-256 hex)", () => {
    const hash = hashMagicToken("test-token");
    expect(hash.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });
});
