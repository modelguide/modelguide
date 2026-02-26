/**
 * Integration tests for connector tool startup sync (sync-tools.ts).
 * Verifies that syncCatalogAndTools() correctly backfills connector_tools
 * and agent_connector_tools when new tools appear in manifests.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  connectorTools,
  connectorsCatalog,
} from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { syncCatalogAndTools } from "@features/connectors/catalog/sync-tools";
import { and, eq } from "drizzle-orm";
import { type TestSeed, getTestSeed } from "../helpers/seed";

let s: TestSeed;

beforeAll(async () => {
  s = await getTestSeed();
  await loadAllManifests();
});

// ============================================================================
// Idempotent — no-op when already in sync
// ============================================================================

describe("syncCatalogAndTools — idempotent", () => {
  test("does not insert duplicates when tools are already in sync", async () => {
    // Count tools before
    const before = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(eq(connectorTools.connectorId, s.orgAMedusaConnectorId)),
    );

    // Run sync (should be a no-op since seed already created all tools)
    await syncCatalogAndTools();

    // Count tools after
    const after = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(eq(connectorTools.connectorId, s.orgAMedusaConnectorId)),
    );

    expect(after.length).toBe(before.length);
  });

  test("can run multiple times without errors", async () => {
    await syncCatalogAndTools();
    await syncCatalogAndTools();
    await syncCatalogAndTools();
    // No error thrown = pass
  });
});

// ============================================================================
// Backfills missing connector_tools
// ============================================================================

describe("syncCatalogAndTools — backfills tools", () => {
  /** IDs of connector_tools deleted during tests (for restore in afterAll) */
  const deletedToolSlugs: string[] = [];

  afterAll(async () => {
    // Re-sync to restore any deleted tools
    if (deletedToolSlugs.length > 0) {
      await syncCatalogAndTools();
    }
  });

  test("inserts missing connector_tools for existing connector", async () => {
    // 1. Delete a tool from orgA's Medusa connector
    const deleted = await forApp((tx) =>
      tx
        .delete(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "list_products"),
          ),
        )
        .returning({ id: connectorTools.id, slug: connectorTools.slug }),
    );

    expect(deleted.length).toBe(1);
    deletedToolSlugs.push(deleted[0].slug);

    // 2. Verify it's gone
    const beforeSync = await forApp((tx) =>
      tx
        .select({ slug: connectorTools.slug })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "list_products"),
          ),
        ),
    );
    expect(beforeSync.length).toBe(0);

    // 3. Run sync
    await syncCatalogAndTools();

    // 4. Verify it was re-created
    const afterSync = await forApp((tx) =>
      tx
        .select({
          slug: connectorTools.slug,
          name: connectorTools.name,
          isActive: connectorTools.isActive,
        })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "list_products"),
          ),
        ),
    );

    expect(afterSync.length).toBe(1);
    expect(afterSync[0].name).toBe("List Products");
    expect(afterSync[0].isActive).toBe(true);
  });

  test("backfills tools across multiple orgs simultaneously", async () => {
    // Delete a tool from both org A and org B Medusa connectors
    await forApp(async (tx) => {
      await tx
        .delete(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_product"),
          ),
        );
      await tx
        .delete(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgBMedusaConnectorId),
            eq(connectorTools.slug, "get_product"),
          ),
        );
    });

    deletedToolSlugs.push("get_product");

    await syncCatalogAndTools();

    // Both should be restored
    const orgA = await forApp((tx) =>
      tx
        .select({ slug: connectorTools.slug })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_product"),
          ),
        ),
    );
    const orgB = await forApp((tx) =>
      tx
        .select({ slug: connectorTools.slug })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgBMedusaConnectorId),
            eq(connectorTools.slug, "get_product"),
          ),
        ),
    );

    expect(orgA.length).toBe(1);
    expect(orgB.length).toBe(1);
  });
});

// ============================================================================
// Backfills agent_connector_tools assignments
// ============================================================================

describe("syncCatalogAndTools — backfills agent assignments", () => {
  afterAll(async () => {
    // Re-sync to restore state
    await syncCatalogAndTools();
  });

  test("auto-assigns new tool to agents that already use the connector", async () => {
    // 1. Find a tool that orgA's agent is currently assigned
    const existingAssignment = await forApp((tx) =>
      tx
        .select({
          connectorToolId: agentConnectorTools.connectorToolId,
          toolSlug: connectorTools.slug,
        })
        .from(agentConnectorTools)
        .innerJoin(
          connectorTools,
          eq(agentConnectorTools.connectorToolId, connectorTools.id),
        )
        .where(
          and(
            eq(agentConnectorTools.agentId, s.orgAAgentId),
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
          ),
        ),
    );

    expect(existingAssignment.length).toBeGreaterThan(0);

    // 2. Delete the "create_cart" tool AND its agent assignments
    const [toolToDelete] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "create_cart"),
          ),
        ),
    );

    await forApp(async (tx) => {
      // Delete agent assignments first (FK constraint)
      await tx
        .delete(agentConnectorTools)
        .where(eq(agentConnectorTools.connectorToolId, toolToDelete.id));
      // Delete the tool
      await tx
        .delete(connectorTools)
        .where(eq(connectorTools.id, toolToDelete.id));
    });

    // 3. Verify both are gone
    const toolGone = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "create_cart"),
          ),
        ),
    );
    expect(toolGone.length).toBe(0);

    // 4. Run sync
    await syncCatalogAndTools();

    // 5. Verify tool is back
    const [restoredTool] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "create_cart"),
          ),
        ),
    );
    expect(restoredTool).toBeDefined();

    // 6. Verify agent assignment was auto-created
    const assignment = await forApp((tx) =>
      tx
        .select({
          isEnabled: agentConnectorTools.isEnabled,
          requiresConfirmation: agentConnectorTools.requiresConfirmation,
        })
        .from(agentConnectorTools)
        .where(
          and(
            eq(agentConnectorTools.agentId, s.orgAAgentId),
            eq(agentConnectorTools.connectorToolId, restoredTool.id),
          ),
        ),
    );

    expect(assignment.length).toBe(1);
    expect(assignment[0].isEnabled).toBe(true);
    // "Create Cart" has defaultRequiresConfirmation: false in manifest
    expect(assignment[0].requiresConfirmation).toBe(false);
  });

  test("sets requiresConfirmation from catalog default", async () => {
    // "Complete Cart" has defaultRequiresConfirmation: true
    const [completeTool] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "complete_cart"),
          ),
        ),
    );

    // Delete the tool and its assignments
    await forApp(async (tx) => {
      await tx
        .delete(agentConnectorTools)
        .where(eq(agentConnectorTools.connectorToolId, completeTool.id));
      await tx
        .delete(connectorTools)
        .where(eq(connectorTools.id, completeTool.id));
    });

    await syncCatalogAndTools();

    // Verify the restored assignment has requiresConfirmation: true
    const [restoredTool] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "complete_cart"),
          ),
        ),
    );

    const [assignment] = await forApp((tx) =>
      tx
        .select({
          requiresConfirmation: agentConnectorTools.requiresConfirmation,
        })
        .from(agentConnectorTools)
        .where(
          and(
            eq(agentConnectorTools.agentId, s.orgAAgentId),
            eq(agentConnectorTools.connectorToolId, restoredTool.id),
          ),
        ),
    );

    expect(assignment.requiresConfirmation).toBe(true);
  });

  test("does not assign to agents that have no existing tools from the connector", async () => {
    // 1. Create a fresh agent with NO tool assignments via direct DB insert
    const [freshAgent] = await forApp((tx) =>
      tx
        .insert(agents)
        .values({
          organizationId: s.orgA.id,
          name: "Sync Test Agent (No Tools)",
          modality: "text",
          isActive: true,
        })
        .returning({ id: agents.id }),
    );

    // 2. Delete a tool so sync has something to insert
    const [toolToDelete] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_order"),
          ),
        ),
    );

    await forApp(async (tx) => {
      await tx
        .delete(agentConnectorTools)
        .where(eq(agentConnectorTools.connectorToolId, toolToDelete.id));
      await tx
        .delete(connectorTools)
        .where(eq(connectorTools.id, toolToDelete.id));
    });

    // 3. Run sync
    await syncCatalogAndTools();

    // 4. The fresh agent should NOT have any assignment for the restored tool
    const [restoredTool] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_order"),
          ),
        ),
    );

    const freshAgentAssignments = await forApp((tx) =>
      tx
        .select({ id: agentConnectorTools.id })
        .from(agentConnectorTools)
        .where(
          and(
            eq(agentConnectorTools.agentId, freshAgent.id),
            eq(agentConnectorTools.connectorToolId, restoredTool.id),
          ),
        ),
    );

    expect(freshAgentAssignments.length).toBe(0);

    // Cleanup: delete the test agent
    await forApp((tx) => tx.delete(agents).where(eq(agents.id, freshAgent.id)));
  });
});

// ============================================================================
// Preserves existing customizations
// ============================================================================

describe("syncCatalogAndTools — preserves customizations", () => {
  afterAll(async () => {
    // Restore any modified tools
    await forApp(async (tx) => {
      await tx
        .update(connectorTools)
        .set({ isActive: true, timeoutSeconds: 30 })
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "add_to_cart"),
          ),
        );
    });
  });

  test("does not overwrite customized isActive or timeoutSeconds", async () => {
    // 1. Customize a tool
    await forApp((tx) =>
      tx
        .update(connectorTools)
        .set({ isActive: false, timeoutSeconds: 120 })
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "add_to_cart"),
          ),
        ),
    );

    // 2. Run sync
    await syncCatalogAndTools();

    // 3. Verify customizations are preserved
    const [tool] = await forApp((tx) =>
      tx
        .select({
          isActive: connectorTools.isActive,
          timeoutSeconds: connectorTools.timeoutSeconds,
        })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "add_to_cart"),
          ),
        ),
    );

    expect(tool.isActive).toBe(false);
    expect(tool.timeoutSeconds).toBe(120);
  });
});

// ============================================================================
// Catalog sync
// ============================================================================

describe("syncCatalogAndTools — catalog", () => {
  test("updates connectors_catalog with current manifest data", async () => {
    await syncCatalogAndTools();

    const [medusa] = await forApp((tx) =>
      tx
        .select()
        .from(connectorsCatalog)
        .where(eq(connectorsCatalog.slug, "medusa")),
    );

    expect(medusa).toBeDefined();
    expect(medusa.isActive).toBe(true);
    expect(medusa.name).toBe("Medusa");
    expect(medusa.tools).toBeArray();
    expect(medusa.tools!.length).toBe(10);
  });
});
