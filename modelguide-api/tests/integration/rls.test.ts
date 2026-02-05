/**
 * Integration tests for Row-Level Security (RLS)
 * Tests organization isolation at the database level
 *
 * NOTE: RLS with connection pooling requires transactions to ensure
 * set_config and queries run on the same connection.
 *
 * IMPORTANT: The application must connect with a non-superuser database role
 * because PostgreSQL superusers bypass RLS even with FORCE ROW LEVEL SECURITY.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@db/client";
import type { Database } from "@db/client";
import {
  agents,
  apiKeys,
  connectorTools,
  connectors,
  connectorsCatalog,
  organizations,
  secrets,
  sessions,
  users,
} from "@db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Execute a function within a transaction with RLS context set.
 * This ensures set_config and queries run on the same connection.
 */
async function withRLSTransaction<T>(
  organizationId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.organization_id', ${organizationId}, true)`,
    );
    return fn(tx as unknown as Database);
  });
}

/**
 * Execute a function within a transaction WITHOUT RLS context (empty org_id).
 * This simulates no authentication context.
 */
async function withoutRLSTransaction<T>(
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organization_id', '', true)`);
    return fn(tx as unknown as Database);
  });
}

// Test fixtures
let orgAId: string;
let orgBId: string;
let _orgAUserId: string;
let orgBUserId: string;
let catalogId: string;
let orgAConnectorId: string;
let orgBConnectorId: string;
let orgAAgentId: string;
let orgBAgentId: string;

beforeAll(async () => {
  // Create test organizations (organizations table has no RLS)
  const [orgA] = await db
    .insert(organizations)
    .values({
      name: `RLS Test Org A ${Date.now()}`,
      slug: `rls-test-org-a-${Date.now()}`,
    })
    .returning();
  orgAId = orgA.id;

  const [orgB] = await db
    .insert(organizations)
    .values({
      name: `RLS Test Org B ${Date.now()}`,
      slug: `rls-test-org-b-${Date.now()}`,
    })
    .returning();
  orgBId = orgB.id;

  // Create a connector catalog entry (global, no RLS)
  const [catalog] = await db
    .insert(connectorsCatalog)
    .values({
      name: "Test Connector",
      slug: `test-connector-${Date.now()}`,
      connectorType: "api",
    })
    .returning();
  catalogId = catalog.id;

  // Create users for each org using RLS context
  const [userA] = await withRLSTransaction(orgAId, async (tx) => {
    return tx
      .insert(users)
      .values({
        organizationId: orgAId,
        email: `rls_user_a_${Date.now()}@test.com`,
        name: "RLS Test User A",
        role: "admin",
      })
      .returning();
  });
  _orgAUserId = userA.id;

  const [userB] = await withRLSTransaction(orgBId, async (tx) => {
    return tx
      .insert(users)
      .values({
        organizationId: orgBId,
        email: `rls_user_b_${Date.now()}@test.com`,
        name: "RLS Test User B",
        role: "admin",
      })
      .returning();
  });
  orgBUserId = userB.id;

  // Create connectors for each org
  const [connectorA] = await withRLSTransaction(orgAId, async (tx) => {
    return tx
      .insert(connectors)
      .values({
        organizationId: orgAId,
        connectorCatalogId: catalogId,
        name: "Org A Connector",
        slug: `org-a-connector-${Date.now()}`,
      })
      .returning();
  });
  orgAConnectorId = connectorA.id;

  const [connectorB] = await withRLSTransaction(orgBId, async (tx) => {
    return tx
      .insert(connectors)
      .values({
        organizationId: orgBId,
        connectorCatalogId: catalogId,
        name: "Org B Connector",
        slug: `org-b-connector-${Date.now()}`,
      })
      .returning();
  });
  orgBConnectorId = connectorB.id;

  // Create agents for each org
  const [agentA] = await withRLSTransaction(orgAId, async (tx) => {
    return tx
      .insert(agents)
      .values({
        organizationId: orgAId,
        name: "Org A Agent",
        agentType: "voice",
      })
      .returning();
  });
  orgAAgentId = agentA.id;

  const [agentB] = await withRLSTransaction(orgBId, async (tx) => {
    return tx
      .insert(agents)
      .values({
        organizationId: orgBId,
        name: "Org B Agent",
        agentType: "voice",
      })
      .returning();
  });
  orgBAgentId = agentB.id;

  // Create connector tools for each org
  await withRLSTransaction(orgAId, async (tx) => {
    return tx.insert(connectorTools).values({
      organizationId: orgAId,
      connectorId: orgAConnectorId,
      name: "Org A Tool",
      slug: `org-a-tool-${Date.now()}`,
    });
  });

  await withRLSTransaction(orgBId, async (tx) => {
    return tx.insert(connectorTools).values({
      organizationId: orgBId,
      connectorId: orgBConnectorId,
      name: "Org B Tool",
      slug: `org-b-tool-${Date.now()}`,
    });
  });

  // Create secrets for each org
  await withRLSTransaction(orgAId, async (tx) => {
    return tx.insert(secrets).values({
      organizationId: orgAId,
      name: "Org A Secret",
      secretType: "api_key",
      encryptedValue: "encrypted_value_a",
      ownerType: "connector",
      ownerId: orgAConnectorId,
    });
  });

  await withRLSTransaction(orgBId, async (tx) => {
    return tx.insert(secrets).values({
      organizationId: orgBId,
      name: "Org B Secret",
      secretType: "api_key",
      encryptedValue: "encrypted_value_b",
      ownerType: "connector",
      ownerId: orgBConnectorId,
    });
  });

  // Create API keys for each org
  await withRLSTransaction(orgAId, async (tx) => {
    return tx.insert(apiKeys).values({
      organizationId: orgAId,
      agentId: orgAAgentId,
      name: "Org A API Key",
      keyHash: `hash_a_${Date.now()}`,
      keyPrefix: "mgk_a",
    });
  });

  await withRLSTransaction(orgBId, async (tx) => {
    return tx.insert(apiKeys).values({
      organizationId: orgBId,
      agentId: orgBAgentId,
      name: "Org B API Key",
      keyHash: `hash_b_${Date.now()}`,
      keyPrefix: "mgk_b",
    });
  });

  // Create sessions for each org
  await withRLSTransaction(orgAId, async (tx) => {
    return tx.insert(sessions).values({
      organizationId: orgAId,
      agentId: orgAAgentId,
      channelType: "voice",
    });
  });

  await withRLSTransaction(orgBId, async (tx) => {
    return tx.insert(sessions).values({
      organizationId: orgBId,
      agentId: orgBAgentId,
      channelType: "voice",
    });
  });
});

afterAll(async () => {
  // Clean up test data using RLS context for each org
  await withRLSTransaction(orgAId, async (tx) => {
    await tx.delete(sessions).where(eq(sessions.organizationId, orgAId));
    await tx.delete(apiKeys).where(eq(apiKeys.organizationId, orgAId));
    await tx.delete(secrets).where(eq(secrets.organizationId, orgAId));
    await tx
      .delete(connectorTools)
      .where(eq(connectorTools.organizationId, orgAId));
    await tx.delete(agents).where(eq(agents.organizationId, orgAId));
    await tx.delete(connectors).where(eq(connectors.organizationId, orgAId));
    await tx.delete(users).where(eq(users.organizationId, orgAId));
  });

  await withRLSTransaction(orgBId, async (tx) => {
    await tx.delete(sessions).where(eq(sessions.organizationId, orgBId));
    await tx.delete(apiKeys).where(eq(apiKeys.organizationId, orgBId));
    await tx.delete(secrets).where(eq(secrets.organizationId, orgBId));
    await tx
      .delete(connectorTools)
      .where(eq(connectorTools.organizationId, orgBId));
    await tx.delete(agents).where(eq(agents.organizationId, orgBId));
    await tx.delete(connectors).where(eq(connectors.organizationId, orgBId));
    await tx.delete(users).where(eq(users.organizationId, orgBId));
  });

  // Clean up global data (no RLS)
  await db.delete(connectorsCatalog).where(eq(connectorsCatalog.id, catalogId));
  await db.delete(organizations).where(eq(organizations.id, orgAId));
  await db.delete(organizations).where(eq(organizations.id, orgBId));
});

// ============================================================================
// Users table RLS tests
// ============================================================================

describe("Users RLS", () => {
  test("Org A can only see Org A users", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(users);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((u) => u.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B users", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(users);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((u) => u.organizationId === orgBId)).toBe(true);
  });

  test("Cannot insert user for different organization", async () => {
    await expect(
      withRLSTransaction(orgAId, async (tx) => {
        return tx.insert(users).values({
          organizationId: orgBId, // Trying to insert for Org B while in Org A context
          email: `forbidden_${Date.now()}@test.com`,
          name: "Forbidden User",
          role: "support",
        });
      }),
    ).rejects.toThrow();
  });

  test("Without RLS context, no users returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(users);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Connectors table RLS tests
// ============================================================================

describe("Connectors RLS", () => {
  test("Org A can only see Org A connectors", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(connectors);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B connectors", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(connectors);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.organizationId === orgBId)).toBe(true);
  });

  test("Cannot insert connector for different organization", async () => {
    await expect(
      withRLSTransaction(orgAId, async (tx) => {
        return tx.insert(connectors).values({
          organizationId: orgBId,
          connectorCatalogId: catalogId,
          name: "Forbidden Connector",
          slug: `forbidden-connector-${Date.now()}`,
        });
      }),
    ).rejects.toThrow();
  });

  test("Without RLS context, no connectors returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(connectors);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Connector Tools table RLS tests
// ============================================================================

describe("Connector Tools RLS", () => {
  test("Org A can only see Org A connector tools", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(connectorTools);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((t) => t.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B connector tools", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(connectorTools);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((t) => t.organizationId === orgBId)).toBe(true);
  });

  test("Without RLS context, no connector tools returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(connectorTools);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Secrets table RLS tests
// ============================================================================

describe("Secrets RLS", () => {
  test("Org A can only see Org A secrets", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(secrets);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((s) => s.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B secrets", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(secrets);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((s) => s.organizationId === orgBId)).toBe(true);
  });

  test("Cannot insert secret for different organization", async () => {
    await expect(
      withRLSTransaction(orgAId, async (tx) => {
        return tx.insert(secrets).values({
          organizationId: orgBId,
          name: "Forbidden Secret",
          secretType: "api_key",
          encryptedValue: "forbidden_value",
          ownerType: "connector",
          ownerId: orgBConnectorId,
        });
      }),
    ).rejects.toThrow();
  });

  test("Without RLS context, no secrets returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(secrets);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Agents table RLS tests
// ============================================================================

describe("Agents RLS", () => {
  test("Org A can only see Org A agents", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(agents);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((a) => a.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B agents", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(agents);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((a) => a.organizationId === orgBId)).toBe(true);
  });

  test("Cannot insert agent for different organization", async () => {
    await expect(
      withRLSTransaction(orgAId, async (tx) => {
        return tx.insert(agents).values({
          organizationId: orgBId,
          name: "Forbidden Agent",
          agentType: "voice",
        });
      }),
    ).rejects.toThrow();
  });

  test("Without RLS context, no agents returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(agents);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// API Keys table RLS tests
// ============================================================================

describe("API Keys RLS", () => {
  test("Org A can only see Org A API keys", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(apiKeys);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((k) => k.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B API keys", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(apiKeys);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((k) => k.organizationId === orgBId)).toBe(true);
  });

  test("Cannot insert API key for different organization", async () => {
    await expect(
      withRLSTransaction(orgAId, async (tx) => {
        return tx.insert(apiKeys).values({
          organizationId: orgBId,
          agentId: orgBAgentId,
          name: "Forbidden API Key",
          keyHash: `forbidden_hash_${Date.now()}`,
          keyPrefix: "mgk_x",
        });
      }),
    ).rejects.toThrow();
  });

  test("Without RLS context, no API keys returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(apiKeys);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Sessions table RLS tests
// ============================================================================

describe("Sessions RLS", () => {
  test("Org A can only see Org A sessions", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(sessions);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((s) => s.organizationId === orgAId)).toBe(true);
  });

  test("Org B can only see Org B sessions", async () => {
    const result = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(sessions);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((s) => s.organizationId === orgBId)).toBe(true);
  });

  test("Cannot insert session for different organization", async () => {
    await expect(
      withRLSTransaction(orgAId, async (tx) => {
        return tx.insert(sessions).values({
          organizationId: orgBId,
          agentId: orgBAgentId,
          channelType: "voice",
        });
      }),
    ).rejects.toThrow();
  });

  test("Without RLS context, no sessions returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(sessions);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Cross-org isolation tests
// ============================================================================

describe("Cross-org isolation", () => {
  test("Org A cannot update Org B data", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      // Try to update Org B's user - should affect 0 rows
      return tx
        .update(users)
        .set({ name: "Hacked Name" })
        .where(eq(users.id, orgBUserId))
        .returning();
    });
    expect(result.length).toBe(0);
  });

  test("Org A cannot delete Org B data", async () => {
    const result = await withRLSTransaction(orgAId, async (tx) => {
      // Try to delete Org B's user - should affect 0 rows
      return tx.delete(users).where(eq(users.id, orgBUserId)).returning();
    });
    expect(result.length).toBe(0);

    // Verify Org B user still exists
    const verifyResult = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(users).where(eq(users.id, orgBUserId));
    });
    expect(verifyResult.length).toBe(1);
  });
});

// ============================================================================
// RLS context management tests
// ============================================================================

describe("RLS context management", () => {
  test("set_config correctly sets the session variable within transaction", async () => {
    const orgId = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.organization_id', ${orgAId}, true)`,
      );
      const result = await tx.execute(
        sql`SELECT current_setting('app.organization_id', true) as org_id`,
      );
      const rows = result as unknown as Array<{ org_id: string }>;
      return rows[0].org_id;
    });
    expect(orgId).toBe(orgAId);
  });

  test("Switching RLS context changes visible data", async () => {
    // First, check Org A
    const orgAUsers = await withRLSTransaction(orgAId, async (tx) => {
      return tx.select().from(users);
    });
    expect(orgAUsers.every((u) => u.organizationId === orgAId)).toBe(true);

    // Then check Org B
    const orgBUsers = await withRLSTransaction(orgBId, async (tx) => {
      return tx.select().from(users);
    });
    expect(orgBUsers.every((u) => u.organizationId === orgBId)).toBe(true);
  });
});
