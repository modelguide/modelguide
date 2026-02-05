/**
 * Database seed script
 * Populates the database with initial data for development/testing
 */

import { generateApiKey } from "@lib/crypto";
import { db } from "../client";
import {
  type CatalogTool,
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  connectorsCatalog,
  organizations,
  users,
} from "../schema";
import { connectorsCatalogSeed } from "./connectors-catalog";

async function seed() {
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

  // 2. Create test organization
  console.log("\nSeeding test organization...");
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Test Organization",
      slug: "test-org",
      settings: {
        timezone: "America/New_York",
        features: ["voice-agents"],
      },
    })
    .onConflictDoNothing()
    .returning();

  if (!org) {
    // Organization already exists, fetch it
    const existingOrg = await db.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.slug, "test-org"),
    });
    if (!existingOrg) {
      console.error("Failed to create or find test organization");
      process.exit(1);
    }
    console.log("  Using existing organization:", existingOrg.name);
    await seedOrgData(existingOrg.id, medusaCatalog.id);
  } else {
    console.log("  Created organization:", org.name);
    await seedOrgData(org.id, medusaCatalog.id);
  }

  console.log("\nSeed completed successfully!");
}

async function seedOrgData(organizationId: string, medusaCatalogId: string) {
  // 3. Create test users
  console.log("\nSeeding test users...");
  const [adminUser] = await db
    .insert(users)
    .values([
      {
        organizationId,
        email: "admin@test-org.com",
        name: "Admin User",
        role: "admin",
        isActive: true,
      },
      {
        organizationId,
        email: "support@test-org.com",
        name: "Support User",
        role: "support",
        isActive: true,
      },
    ])
    .onConflictDoNothing()
    .returning();

  const admin =
    adminUser ||
    (await db.query.users.findFirst({
      where: (u, { eq, and }) =>
        and(
          eq(u.organizationId, organizationId),
          eq(u.email, "admin@test-org.com"),
        ),
    }));

  if (!admin) {
    console.error("Failed to create or find admin user");
    process.exit(1);
  }

  console.log("  Created/found admin user:", admin.email);

  // 4. Create test connector instance
  console.log("\nSeeding test connector...");
  const [connector] = await db
    .insert(connectors)
    .values({
      organizationId,
      connectorCatalogId: medusaCatalogId,
      name: "Pizza Palace Store",
      slug: "pizzapalace",
      config: {
        baseUrl: "https://api.pizzapalace.example.com",
        // In real usage, this would be a secret UUID reference
        apiToken: "placeholder-secret-uuid",
      },
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const testConnector =
    connector ||
    (await db.query.connectors.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.organizationId, organizationId), eq(c.slug, "pizzapalace")),
    }));

  if (!testConnector) {
    console.error("Failed to create or find test connector");
    process.exit(1);
  }

  console.log("  Created/found connector:", testConnector.name);

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
  const [agent] = await db
    .insert(agents)
    .values({
      organizationId,
      name: "Pizza Order Agent",
      description: "Voice agent for handling pizza orders",
      agentType: "voice",
      isActive: true,
      systemPrompt: `You are a helpful pizza ordering assistant for Pizza Palace.
You can help customers:
- Browse the menu
- Add items to their cart
- Check out and place orders
- Track existing orders

Always be friendly and helpful. If you're unsure about something, ask for clarification.`,
      tags: ["pizza", "orders", "voice"],
      metadata: {
        version: "1.0.0",
        language: "en",
      },
      createdBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();

  const testAgent =
    agent ||
    (await db.query.agents.findFirst({
      where: (a, { eq, and }) =>
        and(
          eq(a.organizationId, organizationId),
          eq(a.name, "Pizza Order Agent"),
        ),
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
      name: "Pizza Agent API Key",
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
      tool.name.toLowerCase().includes("cancel"),
  }));

  const linkedTools = await db
    .insert(agentConnectorTools)
    .values(linkValues)
    .onConflictDoNothing()
    .returning();

  console.log(`  Linked ${linkedTools.length} tools to agent`);
}

// Run seed
seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    // Close database connection
    const { closeDatabase } = await import("../client");
    await closeDatabase();
  });
