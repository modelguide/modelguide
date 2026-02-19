/**
 * Unit tests for baseUrl SSRF validation.
 */

import { describe, expect, test } from "bun:test";
import { validateBaseUrl } from "@features/connectors/catalog/lib/validate-url";

describe("validateBaseUrl", () => {
  test("accepts valid HTTPS URL", () => {
    const result = validateBaseUrl("https://api.example.com", "Test");
    expect(result).toBe("https://api.example.com");
  });

  test("accepts valid HTTP URL", () => {
    const result = validateBaseUrl("http://api.example.com", "Test");
    expect(result).toBe("http://api.example.com");
  });

  test("strips trailing slashes", () => {
    const result = validateBaseUrl("https://api.example.com/v1/", "Test");
    expect(result).toBe("https://api.example.com/v1");
  });

  test("preserves path segments", () => {
    const result = validateBaseUrl("https://api.example.com/store/v2", "Test");
    expect(result).toBe("https://api.example.com/store/v2");
  });

  test("rejects non-URL strings", () => {
    expect(() => validateBaseUrl("not-a-url", "Test")).toThrow(
      "not a valid URL",
    );
  });

  test("rejects ftp protocol", () => {
    expect(() => validateBaseUrl("ftp://files.example.com", "Test")).toThrow(
      "must use http or https",
    );
  });

  test("rejects file protocol", () => {
    expect(() => validateBaseUrl("file:///etc/passwd", "Test")).toThrow(
      "must use http or https",
    );
  });

  // --- Private / internal address blocking ---

  test("rejects 10.x.x.x (class A private)", () => {
    expect(() => validateBaseUrl("http://10.0.0.1", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects 172.16.x.x (class B private)", () => {
    expect(() => validateBaseUrl("http://172.16.0.1", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects 172.31.x.x (upper class B private)", () => {
    expect(() => validateBaseUrl("http://172.31.255.255", "Test")).toThrow(
      "private or internal",
    );
  });

  test("allows 172.32.x.x (not private)", () => {
    const result = validateBaseUrl("http://172.32.0.1", "Test");
    expect(result).toBe("http://172.32.0.1");
  });

  test("rejects 192.168.x.x", () => {
    expect(() => validateBaseUrl("http://192.168.1.1", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects 127.0.0.1 (loopback)", () => {
    expect(() => validateBaseUrl("http://127.0.0.1", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects 169.254.x.x (link-local / cloud metadata)", () => {
    expect(() => validateBaseUrl("http://169.254.169.254", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects localhost", () => {
    expect(() => validateBaseUrl("http://localhost", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects localhost with port", () => {
    expect(() => validateBaseUrl("http://localhost:8080", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects IPv6 loopback [::1]", () => {
    expect(() => validateBaseUrl("http://[::1]", "Test")).toThrow(
      "private or internal",
    );
  });

  test("rejects 0.x.x.x", () => {
    expect(() => validateBaseUrl("http://0.0.0.0", "Test")).toThrow(
      "private or internal",
    );
  });

  test("includes connector name in error messages", () => {
    expect(() => validateBaseUrl("ftp://x.com", "Medusa")).toThrow("Medusa");
  });
});
