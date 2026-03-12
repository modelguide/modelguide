/**
 * Unit tests for Medusa connector manifest
 */

import { describe, expect, test } from "bun:test";
import medusaManifest from "@features/connectors/catalog/medusa/index";

describe("Medusa manifest", () => {
  test("has correct slug, name, and connectorType", () => {
    expect(medusaManifest.slug).toBe("medusa");
    expect(medusaManifest.name).toBe("Medusa");
    expect(medusaManifest.connectorType).toBe("api");
  });

  test("has 10 tools", () => {
    expect(medusaManifest.tools).toHaveLength(10);
  });

  test("each tool has catalog and handler", () => {
    for (const tool of medusaManifest.tools) {
      expect(tool.catalog).toBeDefined();
      expect(tool.catalog.name).toBeTruthy();
      expect(tool.catalog.description).toBeTruthy();
      expect(tool.catalog.inputSchema).toBeDefined();
      expect(typeof tool.catalog.defaultRequiresConfirmation).toBe("boolean");
      expect(typeof tool.catalog.defaultTimeoutSeconds).toBe("number");
      expect(tool.handler).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });

  test("all handler functions are async", async () => {
    for (const tool of medusaManifest.tools) {
      const result = tool.handler({
        config: {},
        input: {},
        organizationId: "test-org",
        connectorId: "test-connector",
      });
      // Async functions return promises
      expect(result).toBeInstanceOf(Promise);
      const resolved = await result;
      // Handlers with empty config will fail the fetch, but should still return a result object
      expect(typeof resolved.success).toBe("boolean");
    }
  });

  test("configSchema has required fields", () => {
    expect(medusaManifest.configSchema.baseUrl).toBeDefined();
    expect(medusaManifest.configSchema.baseUrl.required).toBe(true);
    expect(medusaManifest.configSchema.baseUrl.type).toBe("string");

    expect(medusaManifest.configSchema.publishableKey).toBeDefined();
    expect(medusaManifest.configSchema.publishableKey.required).toBe(true);
    expect(medusaManifest.configSchema.publishableKey.type).toBe("string");

    expect(medusaManifest.configSchema.secretApiKey).toBeDefined();
    expect(medusaManifest.configSchema.secretApiKey.required).toBe(false);
    expect(medusaManifest.configSchema.secretApiKey.type).toBe("secret");
  });

  test("healthCheck is a function", () => {
    expect(medusaManifest.healthCheck).toBeDefined();
    expect(typeof medusaManifest.healthCheck).toBe("function");
  });

  test("tool names match expected set", () => {
    const toolNames = medusaManifest.tools.map((t) => t.catalog.name);
    expect(toolNames).toContain("List Products");
    expect(toolNames).toContain("Get Product");
    expect(toolNames).toContain("Create Cart");
    expect(toolNames).toContain("Add to Cart");
    expect(toolNames).toContain("Get Cart");
    expect(toolNames).toContain("Set Delivery Address");
    expect(toolNames).toContain("Complete Cart");
    expect(toolNames).toContain("Get Order");
    expect(toolNames).toContain("Look Up Order");
    expect(toolNames).toContain("Look Up Order History");
  });
});
