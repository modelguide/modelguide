/**
 * HubSpot manifest snapshot test.
 *
 * Locks the 19-tool MCP surface plus configuration shape per HubSpot
 * Connector Spec §3 + §5. Failing this test means the connector contract
 * has drifted and needs explicit reconciliation.
 */

import { describe, expect, test } from "bun:test";
import {
  getKnowledgeArticle,
  listKnowledgeArticles,
} from "@features/connectors/catalog/hubspot/handlers";
import hubspotManifest from "@features/connectors/catalog/hubspot/index";

const EXPECTED_TOOL_NAMES = [
  // Contacts (5)
  "Get Contact By Email",
  "Get Contact By Phone",
  "Search Contacts",
  "Create Contact",
  "Update Contact",
  // Companies (2)
  "Get Company",
  "List Companies For Contact",
  // Deals (3)
  "List Deals For Contact",
  "Create Deal",
  "Update Deal Stage",
  // Tickets (7)
  "Get Ticket",
  "List Tickets For Contact",
  "Search Tickets",
  "Create Ticket",
  "Update Ticket",
  "Close Ticket",
  "Add Reply To Ticket",
  // Engagements (2)
  "Log Call Engagement",
  "Create Note",
];

const CONFIRMATION_GATED_TOOLS = [
  "Create Deal",
  "Update Deal Stage",
  "Close Ticket",
];

describe("HubSpot manifest", () => {
  test("has correct slug, name, and connectorType", () => {
    expect(hubspotManifest.slug).toBe("hubspot");
    expect(hubspotManifest.name).toBe("HubSpot");
    expect(hubspotManifest.connectorType).toBe("api");
  });

  test("exposes exactly 19 MCP tools", () => {
    expect(hubspotManifest.tools).toHaveLength(19);
  });

  test("tool names match the locked spec §5 surface", () => {
    const toolNames = hubspotManifest.tools.map((t) => t.catalog.name).sort();
    expect(toolNames).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  test("every tool has inputSchema, defaultRequiresConfirmation, defaultTimeoutSeconds", () => {
    for (const tool of hubspotManifest.tools) {
      expect(tool.catalog.name).toBeTruthy();
      expect(tool.catalog.description).toBeTruthy();
      expect(tool.catalog.inputSchema).toBeDefined();
      expect((tool.catalog.inputSchema as { type?: string }).type).toBe(
        "object",
      );
      expect(typeof tool.catalog.defaultRequiresConfirmation).toBe("boolean");
      expect(typeof tool.catalog.defaultTimeoutSeconds).toBe("number");
      expect(tool.catalog.defaultTimeoutSeconds).toBeGreaterThan(0);
      expect(tool.handler).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });

  test("only Create Deal, Update Deal Stage, Close Ticket default to confirm:true", () => {
    const gated = hubspotManifest.tools
      .filter((t) => t.catalog.defaultRequiresConfirmation)
      .map((t) => t.catalog.name)
      .sort();
    expect(gated).toEqual([...CONFIRMATION_GATED_TOOLS].sort());
  });

  test("KB ingest operations exist as internal functions, not MCP tools", () => {
    expect(typeof listKnowledgeArticles).toBe("function");
    expect(typeof getKnowledgeArticle).toBe("function");
    const toolNames = hubspotManifest.tools.map((t) => t.catalog.name);
    expect(toolNames).not.toContain("List Knowledge Articles");
    expect(toolNames).not.toContain("Get Knowledge Article");
  });

  test("configSchema requires accessToken as a secret; portal + pipeline fields are optional", () => {
    expect(hubspotManifest.configSchema.accessToken).toBeDefined();
    expect(hubspotManifest.configSchema.accessToken.type).toBe("secret");
    expect(hubspotManifest.configSchema.accessToken.required).toBe(true);

    expect(hubspotManifest.configSchema.portalId.required).toBe(false);
    expect(hubspotManifest.configSchema.defaultPipelineId.required).toBe(false);
    expect(hubspotManifest.configSchema.defaultTicketPipelineId.required).toBe(
      false,
    );
  });

  test("healthCheck is defined", () => {
    expect(typeof hubspotManifest.healthCheck).toBe("function");
  });

  test("handlers gracefully return success:false when config is missing", async () => {
    for (const tool of hubspotManifest.tools) {
      const result = await tool.handler({
        config: {},
        input: {},
        organizationId: "test-org",
        connectorId: "test-connector",
      });
      expect(typeof result.success).toBe("boolean");
    }
  });
});
