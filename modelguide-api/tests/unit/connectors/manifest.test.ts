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

  test("has 8 tools", () => {
    expect(medusaManifest.tools).toHaveLength(8);
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
      expect(resolved.success).toBe(true);
    }
  });

  test("configSchema has required fields", () => {
    expect(medusaManifest.configSchema.baseUrl).toBeDefined();
    expect(medusaManifest.configSchema.baseUrl.required).toBe(true);
    expect(medusaManifest.configSchema.baseUrl.type).toBe("string");

    expect(medusaManifest.configSchema.apiToken).toBeDefined();
    expect(medusaManifest.configSchema.apiToken.required).toBe(true);
    expect(medusaManifest.configSchema.apiToken.type).toBe("secret");
  });

  test("tool names match expected set", () => {
    const toolNames = medusaManifest.tools.map((t) => t.catalog.name);
    expect(toolNames).toContain("Add to Cart");
    expect(toolNames).toContain("Get Cart");
    expect(toolNames).toContain("Create Draft Order");
    expect(toolNames).toContain("Set Delivery Address");
    expect(toolNames).toContain("Confirm Order");
    expect(toolNames).toContain("Get Order");
    expect(toolNames).toContain("Update Order Address");
    expect(toolNames).toContain("Cancel Order");
  });
});
