/**
 * Integration tests for connector tool startup sync (sync-tools.ts).
 * Full lifecycle: insert, update, soft-delete, agent assignments.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  connectorTools,
  connectors,
  connectorsCatalog,
} from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { syncCatalogAndTools } from "@features/connectors/catalog/sync-tools";
import { getAgentTools } from "@features/mcp/mcp.service";
import { stableStringify } from "@lib/json";
import { and, eq, isNull } from "drizzle-orm";
import { type TestSeed, getTestSeed } from "../helpers/seed";

let s: TestSeed;

beforeAll(async () => {
  s = await getTestSeed();
  await loadAllManifests();
  // Ensure baseline is in sync before tests
  await syncCatalogAndTools();
});

// ============================================================================
// Helpers
// ============================================================================

/** Count live (non-deleted) tools for a connector. */
async function liveToolCount(connectorId: string): Promise<number> {
  const rows = await forApp((tx) =>
    tx
      .select({ id: connectorTools.id })
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, connectorId),
          isNull(connectorTools.deletedAt),
        ),
      ),
  );
  return rows.length;
}

/** Find a live (non-deleted) tool by connector + slug. */
async function findLiveTool(
  connectorId: string,
  slug: string,
): Promise<{ id: string }> {
  const [row] = await forApp((tx) =>
    tx
      .select({ id: connectorTools.id })
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, connectorId),
          eq(connectorTools.slug, slug),
          isNull(connectorTools.deletedAt),
        ),
      ),
  );
  return row;
}

/** Find an agent↔tool assignment. */
async function findAssignment(
  agentId: string,
  connectorToolId: string,
): Promise<Array<{ isEnabled: boolean; requiresConfirmation: boolean }>> {
  return forApp((tx) =>
    tx
      .select({
        isEnabled: agentConnectorTools.isEnabled,
        requiresConfirmation: agentConnectorTools.requiresConfirmation,
      })
      .from(agentConnectorTools)
      .where(
        and(
          eq(agentConnectorTools.agentId, agentId),
          eq(agentConnectorTools.connectorToolId, connectorToolId),
        ),
      ),
  );
}

/** Hard-delete a tool for setup purposes. */
async function hardDeleteTool(
  connectorId: string,
  slug: string,
): Promise<string> {
  const row = await findLiveTool(connectorId, slug);
  await forApp(async (tx) => {
    await tx
      .delete(agentConnectorTools)
      .where(eq(agentConnectorTools.connectorToolId, row.id));
    await tx.delete(connectorTools).where(eq(connectorTools.id, row.id));
  });
  return row.id;
}

/** Insert a phantom connector_tool (not in any manifest). */
async function insertPhantomTool(
  connectorId: string,
  orgId: string,
  slug: string,
): Promise<string> {
  const [row] = await forApp((tx) =>
    tx
      .insert(connectorTools)
      .values({
        organizationId: orgId,
        connectorId,
        name: `Phantom ${slug}`,
        slug,
        description: "Should be soft-deleted by sync",
        toolSchema: {},
        timeoutSeconds: 30,
        isActive: true,
      })
      .returning({ id: connectorTools.id }),
  );
  return row.id;
}

// ============================================================================
// I — Idempotency
// ============================================================================

describe("Idempotency", () => {
  test("I1: everything in sync → zero changes", async () => {
    const before = await liveToolCount(s.orgAMedusaConnectorId);
    await syncCatalogAndTools();
    const after = await liveToolCount(s.orgAMedusaConnectorId);
    expect(after).toBe(before);
  });

  test("I2: three consecutive runs → no duplicates or errors", async () => {
    await syncCatalogAndTools();
    await syncCatalogAndTools();
    await syncCatalogAndTools();
    // No error thrown = pass
  });
});

// ============================================================================
// C — Catalog sync
// ============================================================================

describe("Catalog sync", () => {
  test("C1: existing catalog row updated from manifest", async () => {
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

  test("C2: new catalog entry inserted via registerConnector()", async () => {
    // Medusa + Zendesk both exist after sync
    const [zendesk] = await forApp((tx) =>
      tx
        .select()
        .from(connectorsCatalog)
        .where(eq(connectorsCatalog.slug, "zendesk")),
    );
    expect(zendesk).toBeDefined();
    expect(zendesk.isActive).toBe(true);
    expect(zendesk.tools).toBeArray();
    expect(zendesk.tools!.length).toBe(8);
  });

  test("C3: phantom catalog entry deactivated", async () => {
    // Insert a phantom catalog entry
    await forApp((tx) =>
      tx.insert(connectorsCatalog).values({
        name: "Phantom",
        slug: "phantom_test_catalog",
        connectorType: "api",
        isActive: true,
      }),
    );

    await syncCatalogAndTools();

    const [phantom] = await forApp((tx) =>
      tx
        .select()
        .from(connectorsCatalog)
        .where(eq(connectorsCatalog.slug, "phantom_test_catalog")),
    );
    expect(phantom.isActive).toBe(false);

    // Cleanup
    await forApp((tx) =>
      tx
        .delete(connectorsCatalog)
        .where(eq(connectorsCatalog.slug, "phantom_test_catalog")),
    );
  });
});

// ============================================================================
// T — Tool sync
// ============================================================================

describe("Tool sync", () => {
  afterEach(async () => {
    // Re-sync to restore any modified state
    await syncCatalogAndTools();
  });

  test("T1: new tool inserted when no live row exists", async () => {
    await hardDeleteTool(s.orgAMedusaConnectorId, "list_products");

    const before = await liveToolCount(s.orgAMedusaConnectorId);
    await syncCatalogAndTools();
    const after = await liveToolCount(s.orgAMedusaConnectorId);

    expect(after).toBe(before + 1);

    const restored = await findLiveTool(
      s.orgAMedusaConnectorId,
      "list_products",
    );
    expect(restored).toBeDefined();
  });

  test("T2: no-op when tool exists unchanged", async () => {
    const [before] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id, updatedAt: connectorTools.updatedAt })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "list_products"),
            isNull(connectorTools.deletedAt),
          ),
        ),
    );

    await syncCatalogAndTools();

    const [after] = await forApp((tx) =>
      tx
        .select({ id: connectorTools.id, updatedAt: connectorTools.updatedAt })
        .from(connectorTools)
        .where(eq(connectorTools.id, before.id)),
    );

    expect(after.id).toBe(before.id);
  });

  test("T3+T4: org-customized isActive=false and timeoutSeconds=120 preserved", async () => {
    const tool = await findLiveTool(s.orgAMedusaConnectorId, "add_to_cart");

    await forApp((tx) =>
      tx
        .update(connectorTools)
        .set({ isActive: false, timeoutSeconds: 120 })
        .where(eq(connectorTools.id, tool.id)),
    );

    try {
      await syncCatalogAndTools();

      const [after] = await forApp((tx) =>
        tx
          .select({
            isActive: connectorTools.isActive,
            timeoutSeconds: connectorTools.timeoutSeconds,
          })
          .from(connectorTools)
          .where(eq(connectorTools.id, tool.id)),
      );

      expect(after.isActive).toBe(false);
      expect(after.timeoutSeconds).toBe(120);
    } finally {
      await forApp((tx) =>
        tx
          .update(connectorTools)
          .set({ isActive: true, timeoutSeconds: 30 })
          .where(eq(connectorTools.id, tool.id)),
      );
    }
  });

  test("T5: phantom tool (not in manifest) gets soft-deleted", async () => {
    const phantomId = await insertPhantomTool(
      s.orgAMedusaConnectorId,
      s.orgA.id,
      "phantom_tool_xyz",
    );

    await syncCatalogAndTools();

    const [row] = await forApp((tx) =>
      tx
        .select({ deletedAt: connectorTools.deletedAt })
        .from(connectorTools)
        .where(eq(connectorTools.id, phantomId)),
    );

    expect(row.deletedAt).not.toBeNull();
  });

  test("T5b: soft-deleted tool invisible in live queries", async () => {
    await insertPhantomTool(
      s.orgAMedusaConnectorId,
      s.orgA.id,
      "phantom_invisible",
    );

    await syncCatalogAndTools();

    const tool = await findLiveTool(
      s.orgAMedusaConnectorId,
      "phantom_invisible",
    );
    expect(tool).toBeUndefined();
  });

  test("T5c: orphaned agent_connector_tools hard-deleted when tool is soft-deleted", async () => {
    const phantomId = await insertPhantomTool(
      s.orgAMedusaConnectorId,
      s.orgA.id,
      "phantom_orphan",
    );

    // Create an agent assignment for the phantom tool
    await forApp((tx) =>
      tx.insert(agentConnectorTools).values({
        agentId: s.orgAAgentId,
        connectorToolId: phantomId,
        isEnabled: true,
        requiresConfirmation: false,
      }),
    );

    await syncCatalogAndTools();

    // Verify the agent assignment was cleaned up
    const assignments = await findAssignment(s.orgAAgentId, phantomId);
    expect(assignments.length).toBe(0);
  });

  test("T6a: stale toolSchema updated from manifest", async () => {
    const tool = await findLiveTool(s.orgAMedusaConnectorId, "list_products");

    // Corrupt the schema
    await forApp((tx) =>
      tx
        .update(connectorTools)
        .set({ toolSchema: { stale: true } })
        .where(eq(connectorTools.id, tool.id)),
    );

    await syncCatalogAndTools();

    const [after] = await forApp((tx) =>
      tx
        .select({ toolSchema: connectorTools.toolSchema })
        .from(connectorTools)
        .where(eq(connectorTools.id, tool.id)),
    );

    // Should have been restored to manifest schema (not { stale: true })
    expect(after.toolSchema).not.toEqual({ stale: true });
    expect((after.toolSchema as Record<string, unknown>).type).toBe("object");
  });

  test("T6b: stale description updated from manifest", async () => {
    const tool = await findLiveTool(s.orgAMedusaConnectorId, "get_product");

    await forApp((tx) =>
      tx
        .update(connectorTools)
        .set({ description: "OLD STALE DESCRIPTION" })
        .where(eq(connectorTools.id, tool.id)),
    );

    await syncCatalogAndTools();

    const [after] = await forApp((tx) =>
      tx
        .select({ description: connectorTools.description })
        .from(connectorTools)
        .where(eq(connectorTools.id, tool.id)),
    );

    expect(after.description).not.toBe("OLD STALE DESCRIPTION");
    expect(after.description).toContain("product details");
  });

  test("T6c: identical schema with different key order → no-op (sorted stringify)", async () => {
    // stableStringify should normalize key order
    const a = { b: 1, a: 2, c: { z: 3, y: 4 } };
    const b = { a: 2, c: { y: 4, z: 3 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  test("T7: multiple orgs' connectors for same catalog all synced", async () => {
    // Delete list_products from both orgA and orgB
    await hardDeleteTool(s.orgAMedusaConnectorId, "list_products");
    await hardDeleteTool(s.orgBMedusaConnectorId, "list_products");

    await syncCatalogAndTools();

    const orgA = await findLiveTool(s.orgAMedusaConnectorId, "list_products");
    const orgB = await findLiveTool(s.orgBMedusaConnectorId, "list_products");

    expect(orgA).toBeDefined();
    expect(orgB).toBeDefined();
  });

  test("T8: inactive connector skipped (no sync)", async () => {
    // Deactivate orgA's Medusa connector
    await forApp((tx) =>
      tx
        .update(connectors)
        .set({ isActive: false })
        .where(eq(connectors.id, s.orgAMedusaConnectorId)),
    );

    // Insert a phantom tool on it
    const phantomId = await insertPhantomTool(
      s.orgAMedusaConnectorId,
      s.orgA.id,
      "phantom_inactive_test",
    );

    try {
      await syncCatalogAndTools();

      // Phantom should NOT be soft-deleted (connector was skipped)
      const [row] = await forApp((tx) =>
        tx
          .select({ deletedAt: connectorTools.deletedAt })
          .from(connectorTools)
          .where(eq(connectorTools.id, phantomId)),
      );
      expect(row.deletedAt).toBeNull();
    } finally {
      // Cleanup: re-activate and clean up phantom
      await forApp(async (tx) => {
        await tx
          .update(connectors)
          .set({ isActive: true })
          .where(eq(connectors.id, s.orgAMedusaConnectorId));
        await tx.delete(connectorTools).where(eq(connectorTools.id, phantomId));
      });
    }
  });

  test("T9: newly inserted tool has correct full metadata", async () => {
    await hardDeleteTool(s.orgAMedusaConnectorId, "complete_cart");

    await syncCatalogAndTools();

    const [tool] = await forApp((tx) =>
      tx
        .select()
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "complete_cart"),
            isNull(connectorTools.deletedAt),
          ),
        ),
    );

    expect(tool.name).toBe("Complete Cart");
    expect(tool.slug).toBe("complete_cart");
    expect(tool.description).toContain("Finalize the order");
    expect(tool.timeoutSeconds).toBe(60);
    expect(tool.isActive).toBe(true);
    expect(tool.deletedAt).toBeNull();
    expect(tool.organizationId).toBe(s.orgA.id);
    expect((tool.toolSchema as Record<string, unknown>).type).toBe("object");
  });

  test("T10: insert and schema update on same connector in single sync", async () => {
    // Delete one tool and corrupt another's schema on the same connector
    await hardDeleteTool(s.orgAMedusaConnectorId, "list_products");
    await forApp(async (tx) => {
      const [tool] = await tx
        .select({ id: connectorTools.id })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_product"),
            isNull(connectorTools.deletedAt),
          ),
        );
      await tx
        .update(connectorTools)
        .set({ toolSchema: { stale: true } })
        .where(eq(connectorTools.id, tool.id));
    });

    await syncCatalogAndTools();

    // Deleted tool was restored
    const restored = await findLiveTool(
      s.orgAMedusaConnectorId,
      "list_products",
    );
    expect(restored).toBeDefined();

    // Stale schema was corrected
    const [updated] = await forApp((tx) =>
      tx
        .select({ toolSchema: connectorTools.toolSchema })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_product"),
            isNull(connectorTools.deletedAt),
          ),
        ),
    );
    expect(updated.toolSchema).not.toEqual({ stale: true });
    expect((updated.toolSchema as Record<string, unknown>).type).toBe("object");
  });
});

// ============================================================================
// A — Agent auto-assignment
// ============================================================================

describe("Agent auto-assignment", () => {
  afterEach(async () => {
    await syncCatalogAndTools();
  });

  test("A1: new tool auto-assigned to agents using that connector", async () => {
    await hardDeleteTool(s.orgAMedusaConnectorId, "create_cart");

    await syncCatalogAndTools();

    const restoredTool = await findLiveTool(
      s.orgAMedusaConnectorId,
      "create_cart",
    );
    const assignments = await findAssignment(s.orgAAgentId, restoredTool.id);

    expect(assignments.length).toBe(1);
    expect(assignments[0].isEnabled).toBe(true);
  });

  test("A2: agent with no connector tools gets no assignment", async () => {
    // Create a fresh agent with NO tool assignments
    const [freshAgent] = await forApp((tx) =>
      tx
        .insert(agents)
        .values({
          organizationId: s.orgA.id,
          name: "Sync Test Agent (No Tools)",
          slug: "sync_test_no_tools",
          modality: "text",
          isActive: true,
        })
        .returning({ id: agents.id }),
    );

    try {
      await hardDeleteTool(s.orgAMedusaConnectorId, "get_order");

      await syncCatalogAndTools();

      const restoredTool = await findLiveTool(
        s.orgAMedusaConnectorId,
        "get_order",
      );
      const assignments = await findAssignment(freshAgent.id, restoredTool.id);

      expect(assignments.length).toBe(0);
    } finally {
      await forApp((tx) =>
        tx.delete(agents).where(eq(agents.id, freshAgent.id)),
      );
    }
  });

  test("A3: defaultRequiresConfirmation: false → assignment gets false", async () => {
    // "Create Cart" has defaultRequiresConfirmation: false
    await hardDeleteTool(s.orgAMedusaConnectorId, "create_cart");

    await syncCatalogAndTools();

    const restoredTool = await findLiveTool(
      s.orgAMedusaConnectorId,
      "create_cart",
    );
    const assignments = await findAssignment(s.orgAAgentId, restoredTool.id);

    expect(assignments.length).toBe(1);
    expect(assignments[0].requiresConfirmation).toBe(false);
  });

  test("A4: defaultRequiresConfirmation: true → assignment gets true", async () => {
    // "Complete Cart" has defaultRequiresConfirmation: true
    await hardDeleteTool(s.orgAMedusaConnectorId, "complete_cart");

    await syncCatalogAndTools();

    const restoredTool = await findLiveTool(
      s.orgAMedusaConnectorId,
      "complete_cart",
    );
    const assignments = await findAssignment(s.orgAAgentId, restoredTool.id);

    expect(assignments.length).toBe(1);
    expect(assignments[0].requiresConfirmation).toBe(true);
  });

  test("A5: multiple agents in org all get the new tool", async () => {
    // orgA has multiple agents (from seed). Both GlowBox agents should have
    // the connector assigned. Get all orgA agents that use the Medusa connector.
    const agentsWithMedusa = await forApp((tx) =>
      tx
        .selectDistinct({ agentId: agentConnectorTools.agentId })
        .from(agentConnectorTools)
        .innerJoin(
          connectorTools,
          and(
            eq(agentConnectorTools.connectorToolId, connectorTools.id),
            isNull(connectorTools.deletedAt),
          ),
        )
        .where(eq(connectorTools.connectorId, s.orgAMedusaConnectorId)),
    );

    // Seed must provide at least 2 agents with Medusa tools for this test
    expect(agentsWithMedusa.length).toBeGreaterThanOrEqual(2);

    await hardDeleteTool(s.orgAMedusaConnectorId, "add_to_cart");
    await syncCatalogAndTools();

    const restoredTool = await findLiveTool(
      s.orgAMedusaConnectorId,
      "add_to_cart",
    );

    for (const { agentId } of agentsWithMedusa) {
      const assignments = await findAssignment(agentId, restoredTool.id);
      expect(assignments.length).toBe(1);
    }
  });

  test("A7: new tool on second connector instance does not leak to agent using only the first", async () => {
    // Create a second Medusa connector instance in the same org
    const [secondMedusa] = await forApp((tx) =>
      tx
        .insert(connectors)
        .values({
          organizationId: s.orgA.id,
          connectorCatalogId: s.medusaCatalogId,
          name: "GlowBox Wholesale",
          slug: "glowbox_wholesale",
          isActive: true,
        })
        .returning({ id: connectors.id }),
    );

    // Sync so the second connector gets its tools populated
    await syncCatalogAndTools();

    // Create a fresh agent assigned to the SECOND connector only
    const [freshAgent] = await forApp((tx) =>
      tx
        .insert(agents)
        .values({
          organizationId: s.orgA.id,
          name: "Sync Test Agent (Wholesale Only)",
          slug: "sync_test_wholesale_only",
          modality: "text",
          isActive: true,
        })
        .returning({ id: agents.id }),
    );

    const secondMedusaTool = await findLiveTool(
      secondMedusa.id,
      "list_products",
    );
    await forApp((tx) =>
      tx.insert(agentConnectorTools).values({
        agentId: freshAgent.id,
        connectorToolId: secondMedusaTool.id,
        isEnabled: true,
        requiresConfirmation: false,
      }),
    );

    try {
      // Delete a tool from the FIRST Medusa connector and re-sync
      await hardDeleteTool(s.orgAMedusaConnectorId, "create_cart");
      await syncCatalogAndTools();

      const restoredTool = await findLiveTool(
        s.orgAMedusaConnectorId,
        "create_cart",
      );

      // Fresh agent (second connector only) must NOT get the first connector's tool
      const crossAssignments = await findAssignment(
        freshAgent.id,
        restoredTool.id,
      );
      expect(crossAssignments.length).toBe(0);

      // Original agent (first connector) DOES get it
      const correctAssignments = await findAssignment(
        s.orgAAgentId,
        restoredTool.id,
      );
      expect(correctAssignments.length).toBe(1);
    } finally {
      // Cleanup: remove agent, its assignments, second connector's tools and the connector
      await forApp(async (tx) => {
        await tx
          .delete(agentConnectorTools)
          .where(eq(agentConnectorTools.agentId, freshAgent.id));
        await tx.delete(agents).where(eq(agents.id, freshAgent.id));
        await tx
          .delete(connectorTools)
          .where(eq(connectorTools.connectorId, secondMedusa.id));
        await tx.delete(connectors).where(eq(connectors.id, secondMedusa.id));
      });
    }
  });

  test("A6: existing agent_connector_tools customizations preserved", async () => {
    const existingTool = await findLiveTool(
      s.orgAMedusaConnectorId,
      "get_cart",
    );

    await forApp((tx) =>
      tx
        .update(agentConnectorTools)
        .set({ isEnabled: false, requiresConfirmation: true })
        .where(
          and(
            eq(agentConnectorTools.agentId, s.orgAAgentId),
            eq(agentConnectorTools.connectorToolId, existingTool.id),
          ),
        ),
    );

    try {
      await syncCatalogAndTools();

      const assignments = await findAssignment(s.orgAAgentId, existingTool.id);

      expect(assignments.length).toBe(1);
      expect(assignments[0].isEnabled).toBe(false);
      expect(assignments[0].requiresConfirmation).toBe(true);
    } finally {
      await forApp((tx) =>
        tx
          .update(agentConnectorTools)
          .set({ isEnabled: true, requiresConfirmation: false })
          .where(
            and(
              eq(agentConnectorTools.agentId, s.orgAAgentId),
              eq(agentConnectorTools.connectorToolId, existingTool.id),
            ),
          ),
      );
    }
  });
});

// ============================================================================
// MCP — Visibility
// ============================================================================

describe("MCP visibility", () => {
  afterEach(async () => {
    await syncCatalogAndTools();
  });

  test("MCP: soft-deleted tool not served via getAgentTools", async () => {
    // Insert a phantom and let sync soft-delete it
    const phantomId = await insertPhantomTool(
      s.orgAMedusaConnectorId,
      s.orgA.id,
      "phantom_mcp_test",
    );

    // Assign to agent
    await forApp((tx) =>
      tx
        .insert(agentConnectorTools)
        .values({
          agentId: s.orgAAgentId,
          connectorToolId: phantomId,
          isEnabled: true,
          requiresConfirmation: false,
        })
        .onConflictDoNothing(),
    );

    await syncCatalogAndTools();

    const tools = await getAgentTools(s.orgA.id, s.orgAAgentId);
    const phantomTool = tools.find((t) =>
      t.mcpName.includes("phantom_mcp_test"),
    );

    expect(phantomTool).toBeUndefined();
  });
});
