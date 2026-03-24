/**
 * Integration tests for mg add-connectors command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import { connectorTools, connectors, organizations, secrets } from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { eq } from "drizzle-orm";
import { handleAddConnectors } from "../../../src/cli/commands/add-connectors";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-conn-test-${Date.now()}`;
let orgId: string;

beforeAll(async () => {
  await loadAllManifests();
  const org = await handleCreateOrg({
    name: "CLI Connectors Test",
    slug: TEST_SLUG,
    demoEnabled: false,
  });
  orgId = org.id;
});

afterAll(async () => {
  await forApp(async (tx) => {
    // Clean up in reverse dependency order
    const orgConnectors = await tx
      .select({ id: connectors.id })
      .from(connectors)
      .where(eq(connectors.organizationId, orgId));
    for (const c of orgConnectors) {
      await tx
        .delete(connectorTools)
        .where(eq(connectorTools.connectorId, c.id));
    }
    await tx.delete(connectors).where(eq(connectors.organizationId, orgId));
    await tx.delete(secrets).where(eq(secrets.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("add-connectors", () => {
  test("creates a connector with tools materialized", async () => {
    const registry = new IdRegistry();
    const result = await handleAddConnectors(
      orgId,
      [
        {
          name: "Test Store",
          slug: "test_store",
          catalogSlug: "medusa",
          config: { baseUrl: "https://api.test.com" },
          secrets: [{ field: "apiKey", name: "Test API Key", type: "api_key" }],
        },
      ],
      { skipSecrets: true, registry },
    );

    expect(result.created).toBe(1);
    expect(result.existing).toBe(0);
    expect(registry.has("connector", "test_store")).toBe(true);
  });

  test("handles duplicate connector gracefully", async () => {
    const result = await handleAddConnectors(
      orgId,
      [
        {
          name: "Test Store",
          slug: "test_store",
          catalogSlug: "medusa",
          config: {},
          secrets: [],
        },
      ],
      { skipSecrets: true },
    );

    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
  });
});
