/**
 * Unit tests for Zendesk connector manifest
 */

import { describe, expect, test } from "bun:test";
import zendeskManifest from "@features/connectors/catalog/zendesk/index";

describe("Zendesk manifest", () => {
  test("has correct slug, name, and connectorType", () => {
    expect(zendeskManifest.slug).toBe("zendesk");
    expect(zendeskManifest.name).toBe("Zendesk");
    expect(zendeskManifest.connectorType).toBe("api");
  });

  test("has 8 tools", () => {
    expect(zendeskManifest.tools).toHaveLength(8);
  });

  test("each tool has catalog and handler", () => {
    for (const tool of zendeskManifest.tools) {
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
    for (const tool of zendeskManifest.tools) {
      const result = tool.handler({
        config: {},
        input: {},
        organizationId: "test-org",
        connectorId: "test-connector",
      });
      expect(result).toBeInstanceOf(Promise);
      const resolved = await result;
      expect(typeof resolved.success).toBe("boolean");
    }
  });

  test("configSchema has required fields", () => {
    expect(zendeskManifest.configSchema.subdomain).toBeDefined();
    expect(zendeskManifest.configSchema.subdomain.required).toBe(true);
    expect(zendeskManifest.configSchema.subdomain.type).toBe("string");

    expect(zendeskManifest.configSchema.email).toBeDefined();
    expect(zendeskManifest.configSchema.email.required).toBe(true);
    expect(zendeskManifest.configSchema.email.type).toBe("string");

    expect(zendeskManifest.configSchema.apiToken).toBeDefined();
    expect(zendeskManifest.configSchema.apiToken.required).toBe(true);
    expect(zendeskManifest.configSchema.apiToken.type).toBe("secret");
  });

  test("healthCheck is a function", () => {
    expect(zendeskManifest.healthCheck).toBeDefined();
    expect(typeof zendeskManifest.healthCheck).toBe("function");
  });

  test("tool names match expected set", () => {
    const toolNames = zendeskManifest.tools.map((t) => t.catalog.name);
    expect(toolNames).toContain("List Tickets");
    expect(toolNames).toContain("Get Ticket");
    expect(toolNames).toContain("Create Ticket");
    expect(toolNames).toContain("Update Ticket");
    expect(toolNames).toContain("Add Comment");
    expect(toolNames).toContain("Search Tickets");
    expect(toolNames).toContain("List Ticket Comments");
    expect(toolNames).toContain("Get User");
  });

  test("write tools require confirmation", () => {
    const toolMap = Object.fromEntries(
      zendeskManifest.tools.map((t) => [t.catalog.name, t.catalog]),
    );
    expect(toolMap["Create Ticket"].defaultRequiresConfirmation).toBe(true);
    expect(toolMap["Update Ticket"].defaultRequiresConfirmation).toBe(true);
    expect(toolMap["Add Comment"].defaultRequiresConfirmation).toBe(true);
  });
});
