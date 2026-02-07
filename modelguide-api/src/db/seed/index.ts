/**
 * Database seed script
 * Uses migration connection (superuser) to bypass RLS
 */

import { encryptSecret, generateApiKey } from "@lib/crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import {
  type CatalogTool,
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  connectorsCatalog,
  organizations,
  secrets,
  sessions,
  users,
} from "../schema";
import { connectorsCatalogSeed } from "./connectors-catalog";

type SeedDb = PostgresJsDatabase<typeof schema>;

export async function runSeed(connectionString: string) {
  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient, { schema });

  try {
    await seedAll(db);
  } finally {
    await queryClient.end();
  }
}

async function seedAll(db: SeedDb) {
  console.log("Starting database seed...\n");

  // 1. Seed connectors catalog (global)
  console.log("Seeding connectors catalog...");
  const catalogEntries = await db
    .insert(connectorsCatalog)
    .values(connectorsCatalogSeed)
    .onConflictDoNothing()
    .returning();
  console.log(`  Created ${catalogEntries.length} catalog entries`);

  // Get the Medusa catalog entry for creating connector instance
  const medusaCatalog = await db.query.connectorsCatalog.findFirst({
    where: (cat, { eq }) => eq(cat.slug, "medusa"),
  });

  if (!medusaCatalog) {
    console.error("Failed to find Medusa catalog entry");
    process.exit(1);
  }

  // 2. Create test organizations (2 orgs to test RLS isolation)
  console.log("\nSeeding test organizations...");

  // Organization 1: Pizza Palace
  const [org1] = await db
    .insert(organizations)
    .values({
      name: "Pizza Palace",
      slug: "pizza-palace",
      settings: {
        timezone: "America/New_York",
        features: ["voice-agents"],
      },
    })
    .onConflictDoNothing()
    .returning();

  const pizzaOrg =
    org1 ||
    (await db.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.slug, "pizza-palace"),
    }));

  if (!pizzaOrg) {
    console.error("Failed to create or find Pizza Palace organization");
    process.exit(1);
  }
  console.log("  Created/found organization:", pizzaOrg.name);

  // Organization 2: Burger Barn
  const [org2] = await db
    .insert(organizations)
    .values({
      name: "Burger Barn",
      slug: "burger-barn",
      settings: {
        timezone: "America/Los_Angeles",
        features: ["chat-agents"],
      },
    })
    .onConflictDoNothing()
    .returning();

  const burgerOrg =
    org2 ||
    (await db.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.slug, "burger-barn"),
    }));

  if (!burgerOrg) {
    console.error("Failed to create or find Burger Barn organization");
    process.exit(1);
  }
  console.log("  Created/found organization:", burgerOrg.name);

  // Seed data for both organizations
  console.log("\n--- Seeding Pizza Palace data ---");
  await seedOrgData(db, pizzaOrg.id, medusaCatalog.id, "pizza-palace");

  console.log("\n--- Seeding Burger Barn data ---");
  await seedOrgData(db, burgerOrg.id, medusaCatalog.id, "burger-barn");

  console.log("\nSeed completed successfully!");
  console.log("\nTest credentials:");
  console.log("  Pizza Palace: admin@pizza-palace.com");
  console.log("  Burger Barn:  admin@burger-barn.com");
}

async function seedOrgData(
  db: SeedDb,
  organizationId: string,
  medusaCatalogId: string,
  orgSlug: string,
) {
  // 3. Create test users
  console.log("\nSeeding test users...");
  const adminEmail = `admin@${orgSlug}.com`;
  const supportEmail = `support@${orgSlug}.com`;
  const inactiveEmail = `inactive@${orgSlug}.com`;

  const [adminUser] = await db
    .insert(users)
    .values([
      {
        organizationId,
        email: adminEmail,
        name: "Admin User",
        role: "admin",
        isActive: true,
      },
      {
        organizationId,
        email: supportEmail,
        name: "Support User",
        role: "support",
        isActive: true,
      },
      {
        organizationId,
        email: inactiveEmail,
        name: "Inactive User",
        role: "support",
        isActive: false,
      },
    ])
    .onConflictDoNothing()
    .returning();

  const admin =
    adminUser ||
    (await db.query.users.findFirst({
      where: (u, { eq, and }) =>
        and(eq(u.organizationId, organizationId), eq(u.email, adminEmail)),
    }));

  if (!admin) {
    console.error("Failed to create or find admin user");
    process.exit(1);
  }

  console.log("  Created/found admin user:", admin.email);

  // 4. Create test connector instance
  console.log("\nSeeding test connector...");
  const connectorSlug = orgSlug.replace(/-/g, "");
  const [connector] = await db
    .insert(connectors)
    .values({
      organizationId,
      connectorCatalogId: medusaCatalogId,
      name: `${orgSlug} Store`,
      slug: connectorSlug,
      config: {
        baseUrl: `https://api.${orgSlug}.example.com`,
        publishableKey: "pk_placeholder_key",
      },
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const testConnector =
    connector ||
    (await db.query.connectors.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.organizationId, organizationId), eq(c.slug, connectorSlug)),
    }));

  if (!testConnector) {
    console.error("Failed to create or find test connector");
    process.exit(1);
  }

  console.log("  Created/found connector:", testConnector.name);

  // 4b. Create test secret for connector
  console.log("\nSeeding test secret...");
  const encrypted = await encryptSecret(`sk_test_${orgSlug}_placeholder`);
  const [secret] = await db
    .insert(secrets)
    .values({
      organizationId,
      name: `${orgSlug} API Key`,
      secretType: "api_key",
      encryptedValue: encrypted,
      ownerType: "connector",
      ownerId: testConnector.id,
    })
    .onConflictDoNothing()
    .returning();
  console.log(`  Created${secret ? "" : "/found"} secret`);

  // 5. Create connector tools (from catalog)
  console.log("\nSeeding connector tools...");
  const catalog = await db.query.connectorsCatalog.findFirst({
    where: (cat, { eq }) => eq(cat.id, medusaCatalogId),
  });

  if (catalog?.tools && Array.isArray(catalog.tools)) {
    const toolValues = catalog.tools.map((tool: CatalogTool) => ({
      organizationId,
      connectorId: testConnector.id,
      name: tool.name,
      slug: tool.name.toLowerCase().replace(/\s+/g, "_"),
      description: tool.description,
      toolSchema: tool.inputSchema,
      timeoutSeconds: tool.defaultTimeoutSeconds || 30,
      isActive: true,
    }));

    const insertedTools = await db
      .insert(connectorTools)
      .values(toolValues)
      .onConflictDoNothing()
      .returning();

    console.log(`  Created ${insertedTools.length} connector tools`);
  }

  // 6. Create test agent
  console.log("\nSeeding test agent...");
  const agentName = `${orgSlug} Order Agent`;
  const [agent] = await db
    .insert(agents)
    .values({
      organizationId,
      name: agentName,
      description: `Voice agent for handling ${orgSlug} orders`,
      agentType: "voice",
      isActive: true,
      createdBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();

  const testAgent =
    agent ||
    (await db.query.agents.findFirst({
      where: (a, { eq, and }) =>
        and(eq(a.organizationId, organizationId), eq(a.name, agentName)),
    }));

  if (!testAgent) {
    console.error("Failed to create or find test agent");
    process.exit(1);
  }

  console.log("  Created/found agent:", testAgent.name);

  // 7. Create API key for agent
  console.log("\nSeeding API key for agent...");
  const { key, hash, prefix } = generateApiKey();

  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      organizationId,
      agentId: testAgent.id,
      name: `${orgSlug} API Key`,
      keyHash: hash,
      keyPrefix: prefix,
      isActive: true,
      createdBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();

  if (apiKey) {
    console.log("  Created API key");
    console.log("  ========================================");
    console.log("  API KEY (save this - shown only once):");
    console.log(`  ${key}`);
    console.log("  ========================================");
  } else {
    console.log("  API key already exists");
  }

  // 8. Link tools to agent
  console.log("\nLinking tools to agent...");
  const tools = await db.query.connectorTools.findMany({
    where: (t, { eq }) => eq(t.connectorId, testConnector.id),
  });

  const linkValues = tools.map((tool) => ({
    agentId: testAgent.id,
    connectorToolId: tool.id,
    isEnabled: true,
    requiresConfirmation:
      tool.name.toLowerCase().includes("confirm") ||
      tool.name.toLowerCase().includes("cancel") ||
      tool.name.toLowerCase().includes("complete"),
  }));

  const linkedTools = await db
    .insert(agentConnectorTools)
    .values(linkValues)
    .onConflictDoNothing()
    .returning();

  console.log(`  Linked ${linkedTools.length} tools to agent`);

  // 9. Create test session
  console.log("\nSeeding test session...");
  await db
    .insert(sessions)
    .values({
      organizationId,
      agentId: testAgent.id,
      channelType: "voice",
      status: "active",
    })
    .onConflictDoNothing();
  console.log("  Created/found session");
}

// CLI entry point
if (import.meta.main) {
  const connectionString =
    process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("DATABASE_MIGRATION_URL or DATABASE_URL must be set");
    process.exit(1);
  }

  runSeed(connectionString).catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
}
