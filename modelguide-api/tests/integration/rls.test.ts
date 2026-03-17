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

import { beforeAll, describe, expect, test } from "bun:test";
import { db } from "@db/client";
import {
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  secrets,
  sessions,
  users,
} from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { withRLSTransaction, withoutRLSTransaction } from "../helpers/rls";
import { type TestSeed, getTestSeed } from "../helpers/seed";

let s: TestSeed;

beforeAll(async () => {
  s = await getTestSeed();
});

// ============================================================================
// Organizations table RLS tests
// ============================================================================

describe("Organizations RLS", () => {
  test("Org A can only see Org A organization", async () => {
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(organizations);
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(s.orgA.id);
  });

  test("Org B can only see Org B organization", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(organizations);
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(s.orgB.id);
  });

  test("Without RLS context, no organizations returned", async () => {
    const result = await withoutRLSTransaction(async (tx) => {
      return tx.select().from(organizations);
    });
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Users table RLS tests
// ============================================================================

describe("Users RLS", () => {
  test("Org A can only see Org A users", async () => {
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(users);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((u) => u.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B users", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(users);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((u) => u.organizationId === s.orgB.id)).toBe(true);
  });

  test("Cannot insert user for different organization", async () => {
    await expect(
      withRLSTransaction(s.orgA.id, async (tx) => {
        return tx.insert(users).values({
          organizationId: s.orgB.id,
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(connectors);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B connectors", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(connectors);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.organizationId === s.orgB.id)).toBe(true);
  });

  test("Cannot insert connector for different organization", async () => {
    await expect(
      withRLSTransaction(s.orgA.id, async (tx) => {
        return tx.insert(connectors).values({
          organizationId: s.orgB.id,
          connectorCatalogId: s.medusaCatalogId,
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(connectorTools);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((t) => t.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B connector tools", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(connectorTools);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((t) => t.organizationId === s.orgB.id)).toBe(true);
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(secrets);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B secrets", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(secrets);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.organizationId === s.orgB.id)).toBe(true);
  });

  test("Cannot insert secret for different organization", async () => {
    await expect(
      withRLSTransaction(s.orgA.id, async (tx) => {
        return tx.insert(secrets).values({
          organizationId: s.orgB.id,
          name: "Forbidden Secret",
          secretType: "api_key",
          encryptedValue: "forbidden_value",
          scope: "connector",
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(agents);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((a) => a.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B agents", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(agents);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((a) => a.organizationId === s.orgB.id)).toBe(true);
  });

  test("Cannot insert agent for different organization", async () => {
    await expect(
      withRLSTransaction(s.orgA.id, async (tx) => {
        return tx.insert(agents).values({
          organizationId: s.orgB.id,
          name: "Forbidden Agent",
          slug: "forbidden-agent",
          modality: "voice",
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(apiKeys);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((k) => k.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B API keys", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(apiKeys);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((k) => k.organizationId === s.orgB.id)).toBe(true);
  });

  test("Cannot insert API key for different organization", async () => {
    await expect(
      withRLSTransaction(s.orgA.id, async (tx) => {
        return tx.insert(apiKeys).values({
          organizationId: s.orgB.id,
          agentId: s.orgBAgentId,
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(sessions);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.organizationId === s.orgA.id)).toBe(true);
  });

  test("Org B can only see Org B sessions", async () => {
    const result = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(sessions);
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.organizationId === s.orgB.id)).toBe(true);
  });

  test("Cannot insert session for different organization", async () => {
    await expect(
      withRLSTransaction(s.orgA.id, async (tx) => {
        return tx.insert(sessions).values({
          organizationId: s.orgB.id,
          agentId: s.orgBAgentId,
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
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx
        .update(users)
        .set({ name: "Hacked Name" })
        .where(eq(users.id, s.orgBAdmin.id))
        .returning();
    });
    expect(result.length).toBe(0);
  });

  test("Org A cannot delete Org B data", async () => {
    const result = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.delete(users).where(eq(users.id, s.orgBAdmin.id)).returning();
    });
    expect(result.length).toBe(0);

    // Verify Org B user still exists
    const verifyResult = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(users).where(eq(users.id, s.orgBAdmin.id));
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
        sql`SELECT set_config('app.organization_id', ${s.orgA.id}, true)`,
      );
      const result = await tx.execute(
        sql`SELECT current_setting('app.organization_id', true) as org_id`,
      );
      const rows = result as unknown as Array<{ org_id: string }>;
      return rows[0].org_id;
    });
    expect(orgId).toBe(s.orgA.id);
  });

  test("Switching RLS context changes visible data", async () => {
    const orgAUsers = await withRLSTransaction(s.orgA.id, async (tx) => {
      return tx.select().from(users);
    });
    expect(orgAUsers.every((u) => u.organizationId === s.orgA.id)).toBe(true);

    const orgBUsers = await withRLSTransaction(s.orgB.id, async (tx) => {
      return tx.select().from(users);
    });
    expect(orgBUsers.every((u) => u.organizationId === s.orgB.id)).toBe(true);
  });
});
