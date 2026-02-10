/**
 * Integration tests for Zendesk connector catalog + instance provisioning.
 * Verifies that Zendesk appears in the catalog with correct metadata
 * and that creating a Zendesk connector instance provisions all 8 tools.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { connectors } from "@db/schema";
import { eq } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let adminHeaders: Record<string, string>;
let zendeskCatalogId: string;

const createdConnectorIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  adminHeaders = await authHeadersFor(s.pizzaAdmin);

  // Look up the Zendesk catalog entry
  const catalogResponse = await request("/api/connectors/catalog", {
    headers: adminHeaders,
  });
  const catalogBody = await catalogResponse.json();
  const zendesk = catalogBody.data.find(
    (c: { slug: string }) => c.slug === "zendesk",
  );
  zendeskCatalogId = zendesk?.id;
});

afterAll(async () => {
  if (createdConnectorIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdConnectorIds) {
        await tx.delete(connectors).where(eq(connectors.id, id));
      }
    });
  }
});

// ============================================================================
// Catalog presence
// ============================================================================

describe("Zendesk catalog entry", () => {
  test("appears in catalog list", () => {
    expect(zendeskCatalogId).toBeDefined();
    expect(typeof zendeskCatalogId).toBe("string");
  });

  test("has correct metadata", async () => {
    const response = await request(
      `/api/connectors/catalog/${zendeskCatalogId}`,
      { headers: adminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.slug).toBe("zendesk");
    expect(body.name).toBe("Zendesk");
    expect(body.connectorType).toBe("api");
    expect(body.isActive).toBe(true);
  });

  test("has correct configSchema with subdomain, email, apiToken", async () => {
    const response = await request(
      `/api/connectors/catalog/${zendeskCatalogId}`,
      { headers: adminHeaders },
    );

    const body = await response.json();
    const schema = body.configSchema;

    expect(schema.subdomain).toBeDefined();
    expect(schema.subdomain.type).toBe("string");
    expect(schema.subdomain.required).toBe(true);

    expect(schema.email).toBeDefined();
    expect(schema.email.type).toBe("string");
    expect(schema.email.required).toBe(true);

    expect(schema.apiToken).toBeDefined();
    expect(schema.apiToken.type).toBe("secret");
    expect(schema.apiToken.required).toBe(true);
  });

  test("has 8 tools defined", async () => {
    const response = await request(
      `/api/connectors/catalog/${zendeskCatalogId}`,
      { headers: adminHeaders },
    );

    const body = await response.json();
    expect(body.tools).toBeArray();
    expect(body.tools.length).toBe(8);

    const toolNames = body.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("List Tickets");
    expect(toolNames).toContain("Get Ticket");
    expect(toolNames).toContain("Create Ticket");
    expect(toolNames).toContain("Update Ticket");
    expect(toolNames).toContain("Add Comment");
    expect(toolNames).toContain("Search Tickets");
    expect(toolNames).toContain("List Ticket Comments");
    expect(toolNames).toContain("Get User");
  });

  test("Create Ticket requires only subject and body (anonymous drops)", async () => {
    const response = await request(
      `/api/connectors/catalog/${zendeskCatalogId}`,
      { headers: adminHeaders },
    );

    const body = await response.json();
    const createTool = body.tools.find(
      (t: { name: string }) => t.name === "Create Ticket",
    );

    expect(createTool).toBeDefined();
    expect(createTool.inputSchema.required).toEqual(["subject", "body"]);
    expect(createTool.defaultRequiresConfirmation).toBe(true);
  });

  test("write tools require confirmation, read tools do not", async () => {
    const response = await request(
      `/api/connectors/catalog/${zendeskCatalogId}`,
      { headers: adminHeaders },
    );

    const body = await response.json();
    const toolMap = Object.fromEntries(
      body.tools.map((t: { name: string }) => [t.name, t]),
    );

    // Write operations require confirmation
    expect(toolMap["Create Ticket"].defaultRequiresConfirmation).toBe(true);
    expect(toolMap["Update Ticket"].defaultRequiresConfirmation).toBe(true);
    expect(toolMap["Add Comment"].defaultRequiresConfirmation).toBe(true);

    // Read operations do not
    expect(toolMap["List Tickets"].defaultRequiresConfirmation).toBe(false);
    expect(toolMap["Get Ticket"].defaultRequiresConfirmation).toBe(false);
    expect(toolMap["Search Tickets"].defaultRequiresConfirmation).toBe(false);
    expect(toolMap["List Ticket Comments"].defaultRequiresConfirmation).toBe(
      false,
    );
    expect(toolMap["Get User"].defaultRequiresConfirmation).toBe(false);
  });
});

// ============================================================================
// Instance provisioning
// ============================================================================

describe("Zendesk connector instance", () => {
  test("creates instance with 8 provisioned tools (201)", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        connectorCatalogId: zendeskCatalogId,
        name: "Test Zendesk",
        slug: "test-zendesk",
        config: {
          subdomain: "testco",
          email: "agent@testco.com",
          apiToken: "secret-token",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connector = await response.json();
    createdConnectorIds.push(connector.id);

    expect(connector.name).toBe("Test Zendesk");
    expect(connector.slug).toBe("test-zendesk");
    expect(connector.connectorCatalogId).toBe(zendeskCatalogId);

    // Verify 8 tools were provisioned
    const toolsResponse = await request(
      `/api/connectors/${connector.id}/tools`,
      { headers: adminHeaders },
    );
    expect(toolsResponse.status).toBe(200);

    const toolsBody = await toolsResponse.json();
    expect(toolsBody.data.length).toBe(8);

    // Verify tool slugs are snake_case
    for (const tool of toolsBody.data) {
      expect(tool.slug).toMatch(/^[a-z_]+$/);
      expect(tool.isActive).toBe(true);
      expect(tool.connectorId).toBe(connector.id);
    }

    const slugs = toolsBody.data.map((t: { slug: string }) => t.slug);
    expect(slugs).toContain("list_tickets");
    expect(slugs).toContain("get_ticket");
    expect(slugs).toContain("create_ticket");
    expect(slugs).toContain("update_ticket");
    expect(slugs).toContain("add_comment");
    expect(slugs).toContain("search_tickets");
    expect(slugs).toContain("list_ticket_comments");
    expect(slugs).toContain("get_user");
  });

  test("rejects duplicate slug within same org (409)", async () => {
    // First instance already created above with slug "test-zendesk"
    const response = await request("/api/connectors", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        connectorCatalogId: zendeskCatalogId,
        name: "Duplicate Zendesk",
        slug: "test-zendesk",
      }),
    });

    expect(response.status).toBe(409);
  });

  test("stores config on the instance", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        connectorCatalogId: zendeskCatalogId,
        name: "Config Test Zendesk",
        slug: "config-test-zendesk",
        config: {
          subdomain: "mycompany",
          email: "support@mycompany.com",
          apiToken: "tok_123",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connector = await response.json();
    createdConnectorIds.push(connector.id);

    // Fetch and verify config is stored
    const getResponse = await request(`/api/connectors/${connector.id}`, {
      headers: adminHeaders,
    });
    expect(getResponse.status).toBe(200);
    const body = await getResponse.json();
    expect(body.config.subdomain).toBe("mycompany");
    expect(body.config.email).toBe("support@mycompany.com");
  });
});
