/**
 * Integration tests for mg import-sops command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agentSops,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  sopSteps,
  sops,
  users,
} from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { eq } from "drizzle-orm";
import { handleAddAgents } from "../../../src/cli/commands/add-agents";
import { handleAddConnectors } from "../../../src/cli/commands/add-connectors";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { handleImportSops } from "../../../src/cli/commands/import-sops";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-sops-test-${Date.now()}`;
let orgId: string;
let registry: IdRegistry;

beforeAll(async () => {
  await loadAllManifests();
  registry = new IdRegistry();

  const org = await handleCreateOrg(
    { name: "CLI SOPs Test", slug: TEST_SLUG, demoEnabled: false },
    registry,
  );
  orgId = org.id;

  await handleAddUsers(
    orgId,
    [{ email: "sop-admin@test.com", name: "SOP Admin", role: "admin" }],
    registry,
  );

  await handleAddConnectors(
    orgId,
    [
      {
        name: "SOP Test Store",
        slug: "sop_test_store",
        catalogSlug: "medusa",
        config: { baseUrl: "https://api.sop-test.com" },
        secrets: [],
      },
    ],
    { skipSecrets: true, registry },
  );

  await handleAddAgents(
    orgId,
    [
      {
        name: "SOP Test Agent",
        slug: "sop-test-agent",
        modality: "voice",
        platform: "custom",
        active: false,
        tools: [{ connectorSlug: "sop_test_store" }],
        secrets: [],
      },
    ],
    { registry },
  );
});

afterAll(async () => {
  await forApp(async (tx) => {
    // Clean up in dependency order
    await tx
      .delete(agentSops)
      .where(
        eq(
          agentSops.agentId,
          tx
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.organizationId, orgId))
            .limit(1),
        ),
      )
      .catch(() => {});

    const orgSops = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.organizationId, orgId));
    for (const s of orgSops) {
      await tx.delete(agentSops).where(eq(agentSops.sopId, s.id));
      await tx.delete(sopSteps).where(eq(sopSteps.sopId, s.id));
    }
    await tx.delete(sops).where(eq(sops.organizationId, orgId));

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
    await tx.delete(users).where(eq(users.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("import-sops", () => {
  test("creates inline SOP with steps", async () => {
    const result = await handleImportSops(
      orgId,
      [
        {
          name: "Test Greeting SOP",
          slug: "test-greeting-sop",
          description: "A test SOP for integration testing",
          status: "draft",
          agents: ["sop-test-agent"],
          steps: [
            {
              id: "greet",
              instruction: "Greet the customer warmly",
              required: true,
            },
            {
              id: "identify",
              instruction: "Ask for order number",
              required: true,
            },
          ],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);
    expect(result.existing).toBe(0);
    expect(result.activated).toBe(0);
    expect(registry.has("sop", "test-greeting-sop")).toBe(true);

    // Verify steps in DB
    const sopId = registry.get("sop", "test-greeting-sop");
    const steps = await forApp(async (tx) => {
      return tx.select().from(sopSteps).where(eq(sopSteps.sopId, sopId));
    });
    expect(steps.length).toBe(2);
  });

  test("creates and activates SOP", async () => {
    const result = await handleImportSops(
      orgId,
      [
        {
          name: "Active SOP",
          slug: "active-sop",
          status: "active",
          agents: ["sop-test-agent"],
          steps: [
            {
              id: "step1",
              instruction: "Do something",
              required: true,
            },
          ],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);
    expect(result.activated).toBe(1);

    // Verify status in DB
    const sopId = registry.get("sop", "active-sop");
    const [sop] = await forApp(async (tx) => {
      return tx.select().from(sops).where(eq(sops.id, sopId));
    });
    expect(sop.status).toBe("active");
  });

  test("assigns agents to SOP", async () => {
    const sopId = registry.get("sop", "test-greeting-sop");
    const agentId = registry.get("agent", "sop-test-agent");

    const assignments = await forApp(async (tx) => {
      return tx.select().from(agentSops).where(eq(agentSops.sopId, sopId));
    });
    expect(assignments.length).toBe(1);
    expect(assignments[0].agentId).toBe(agentId);
  });

  test("handles duplicate SOP gracefully", async () => {
    const result = await handleImportSops(
      orgId,
      [
        {
          name: "Test Greeting SOP",
          slug: "test-greeting-sop",
          status: "draft",
          agents: [],
          steps: [
            {
              id: "greet",
              instruction: "Greet the customer",
              required: true,
            },
          ],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
  });

  test("rejects inline SOP without steps", async () => {
    expect(
      handleImportSops(
        orgId,
        [
          {
            name: "No Steps SOP",
            slug: "no-steps-sop",
            status: "draft",
            agents: [],
            steps: [],
          },
        ],
        { registry },
      ),
    ).rejects.toThrow("must have at least one step");
  });

  test("--replace deletes and recreates SOP with same slug", async () => {
    const createResult = await handleImportSops(
      orgId,
      [
        {
          name: "Replaceable SOP",
          slug: "replaceable-sop",
          status: "active",
          agents: ["sop-test-agent"],
          steps: [
            { id: "original", instruction: "Original step", required: true },
          ],
        },
      ],
      { registry },
    );
    expect(createResult.created).toBe(1);
    const originalId = registry.get("sop", "replaceable-sop");

    const replaceResult = await handleImportSops(
      orgId,
      [
        {
          name: "Replaceable SOP",
          slug: "replaceable-sop",
          status: "active",
          agents: ["sop-test-agent"],
          steps: [
            { id: "new-a", instruction: "New step A", required: true },
            { id: "new-b", instruction: "New step B", required: true },
          ],
        },
      ],
      { registry, replace: true },
    );
    expect(replaceResult.replaced).toBe(1);
    expect(replaceResult.created).toBe(1);
    expect(replaceResult.existing).toBe(0);

    const newId = registry.get("sop", "replaceable-sop");
    expect(newId).not.toBe(originalId);

    const steps = await forApp(async (tx) => {
      return tx.select().from(sopSteps).where(eq(sopSteps.sopId, newId));
    });
    expect(steps.length).toBe(2);
    expect(steps.map((s) => s.stepId).sort()).toEqual(["new-a", "new-b"]);

    const originalStillExists = await forApp(async (tx) => {
      return tx.select().from(sops).where(eq(sops.id, originalId));
    });
    expect(originalStillExists.length).toBe(0);

    const assignments = await forApp(async (tx) => {
      return tx.select().from(agentSops).where(eq(agentSops.sopId, newId));
    });
    expect(assignments.length).toBe(1);
  });

  test("resolves agents and connector tools without registry", async () => {
    const [tool] = await forApp(async (tx) => {
      return tx
        .select({ slug: connectorTools.slug })
        .from(connectorTools)
        .where(
          eq(
            connectorTools.connectorId,
            registry.get("connector", "sop_test_store"),
          ),
        )
        .limit(1);
    });

    expect(tool).toBeDefined();

    const result = await handleImportSops(orgId, [
      {
        name: "Standalone Inline SOP",
        slug: "standalone-inline-sop",
        status: "draft",
        agents: ["sop-test-agent"],
        steps: [
          {
            id: "lookup",
            instruction: "Use the connector tool",
            required: true,
            tool: {
              connectorSlug: "sop_test_store",
              toolSlug: tool!.slug,
            },
          },
        ],
      },
    ]);

    expect(result.created).toBe(1);

    const [createdSop] = await forApp(async (tx) => {
      return tx
        .select({ id: sops.id })
        .from(sops)
        .where(eq(sops.slug, "standalone-inline-sop"));
    });
    expect(createdSop).toBeDefined();

    const assignments = await forApp(async (tx) => {
      return tx
        .select()
        .from(agentSops)
        .where(eq(agentSops.sopId, createdSop!.id));
    });
    expect(assignments.length).toBe(1);
  });
});
