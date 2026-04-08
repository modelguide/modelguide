/**
 * Integration tests for mg add-agents command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  secrets,
  users,
} from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { eq } from "drizzle-orm";
import { handleAddAgents } from "../../../src/cli/commands/add-agents";
import { handleAddConnectors } from "../../../src/cli/commands/add-connectors";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-agents-test-${Date.now()}`;
let orgId: string;
let registry: IdRegistry;

beforeAll(async () => {
  await loadAllManifests();
  registry = new IdRegistry();

  const org = await handleCreateOrg(
    { name: "CLI Agents Test", slug: TEST_SLUG, demoEnabled: false },
    registry,
  );
  orgId = org.id;

  // Create a user (needed for createdBy)
  await handleAddUsers(
    orgId,
    [
      {
        email: "agent-test-admin@test.com",
        name: "Agent Admin",
        role: "admin",
      },
    ],
    registry,
  );

  // Create a connector (for tool assignment)
  await handleAddConnectors(
    orgId,
    [
      {
        name: "Agent Test Store",
        slug: "agent_test_store",
        catalogSlug: "medusa",
        config: { baseUrl: "https://api.agent-test.com" },
        secrets: [],
      },
    ],
    { skipSecrets: true, registry },
  );
});

afterAll(async () => {
  await forApp(async (tx) => {
    const orgAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.organizationId, orgId));
    for (const a of orgAgents) {
      await tx
        .delete(agentConnectorTools)
        .where(eq(agentConnectorTools.agentId, a.id));
      await tx.delete(apiKeys).where(eq(apiKeys.agentId, a.id));
    }
    await tx.delete(agents).where(eq(agents.organizationId, orgId));

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
    await tx.delete(users).where(eq(users.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("add-agents", () => {
  test("creates agent with API key returned", async () => {
    const result = await handleAddAgents(
      orgId,
      [
        {
          name: "Test Voice Agent",
          slug: "test-voice-agent",
          modality: "voice",
          platform: "custom",
          active: false,
          tools: [],
          secrets: [],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);
    expect(result.existing).toBe(0);
    expect(result.apiKeys.length).toBe(1);
    expect(result.apiKeys[0].name).toBe("Test Voice Agent");
    expect(result.apiKeys[0].key).toMatch(/^mgk_/);
    expect(registry.has("agent", "test-voice-agent")).toBe(true);
  });

  test("creates agent with connector tool assignment", async () => {
    const result = await handleAddAgents(
      orgId,
      [
        {
          name: "Tooled Agent",
          slug: "tooled-agent",
          modality: "text",
          platform: "custom",
          active: false,
          tools: [{ connectorSlug: "agent_test_store" }],
          secrets: [],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);
    expect(result.apiKeys.length).toBe(1);

    // Verify tools were assigned via DB
    const agentId = registry.get("agent", "tooled-agent");
    const assigned = await forApp(async (tx) => {
      return tx
        .select()
        .from(agentConnectorTools)
        .where(eq(agentConnectorTools.agentId, agentId));
    });
    expect(assigned.length).toBeGreaterThan(0);
  });

  test("looks up createdBy from DB when no registry", async () => {
    const result = await handleAddAgents(orgId, [
      {
        name: "No Registry Agent",
        slug: "no-registry-agent",
        modality: "voice",
        platform: "custom",
        active: false,
        tools: [],
        secrets: [],
      },
    ]);

    expect(result.created).toBe(1);
    expect(result.apiKeys.length).toBe(1);
  });

  test("handles duplicate agent gracefully", async () => {
    const result = await handleAddAgents(orgId, [
      {
        name: "Test Voice Agent",
        slug: "test-voice-agent",
        modality: "voice",
        platform: "custom",
        active: false,
        tools: [],
        secrets: [],
      },
    ]);

    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
    expect(result.apiKeys.length).toBe(0);
  });

  test("warns on unknown connector slug", async () => {
    const result = await handleAddAgents(
      orgId,
      [
        {
          name: "Unknown Connector Agent",
          slug: "unknown-conn-agent",
          modality: "voice",
          platform: "custom",
          active: false,
          tools: [{ connectorSlug: "nonexistent_connector" }],
          secrets: [],
        },
      ],
      { registry },
    );

    // Agent still created, just tool assignment skipped
    expect(result.created).toBe(1);
  });
});
