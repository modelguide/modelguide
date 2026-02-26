/**
 * Generic organization seeder.
 * Creates one org with users, both Medusa + Zendesk connectors,
 * agents, API keys, handwritten sessions, and generated sessions.
 */

import { encryptSecret, generateApiKey } from "@lib/crypto";
import { toolSlug } from "@lib/slugify";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import {
  type CatalogTool,
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  secrets,
  sessionFeedback,
  sessionLinks,
  sessionMessages,
  sessions,
  users,
} from "../schema";
import { generateSessions } from "./session-generator";
import type { OrgVerticalConfig } from "./verticals/types";

type SeedDb = PostgresJsDatabase<typeof schema>;

export interface CatalogEntry {
  id: string;
  slug: string;
  tools: CatalogTool[] | unknown;
}

export async function seedOrg(
  db: SeedDb,
  config: OrgVerticalConfig,
  catalogs: { medusa: CatalogEntry; zendesk: CatalogEntry },
): Promise<void> {
  console.log(`\n--- Seeding ${config.org.name} (${config.org.slug}) ---`);

  // 1. Create organization (upsert demoEnabled on re-seed)
  const orgValues = {
    name: config.org.name,
    slug: config.org.slug,
    settings: {
      timezone: config.org.timezone,
      features: config.org.features,
    },
    demoEnabled: config.org.demoEnabled ?? false,
  };

  const [org] = await db
    .insert(organizations)
    .values(orgValues)
    .onConflictDoUpdate({
      target: organizations.slug,
      set: { demoEnabled: orgValues.demoEnabled },
    })
    .returning();

  const orgRecord =
    org ??
    (await db.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.slug, config.org.slug),
    }));

  if (!orgRecord) {
    console.error(`  Failed to create/find org ${config.org.slug}`);
    return;
  }
  const organizationId = orgRecord.id;
  console.log(`  Created/found org: ${orgRecord.name}`);

  // 2. Create users (admin, support, viewer, inactive)
  const userValues = [
    {
      organizationId,
      email: config.users.admin.email,
      name: config.users.admin.name,
      role: "admin" as const,
      isActive: true,
    },
    {
      organizationId,
      email: config.users.support.email,
      name: config.users.support.name,
      role: "support" as const,
      isActive: true,
    },
    {
      organizationId,
      email: config.users.viewer.email,
      name: config.users.viewer.name,
      role: "viewer" as const,
      isActive: true,
    },
    {
      organizationId,
      email: config.users.inactive.email,
      name: config.users.inactive.name,
      role: "support" as const,
      isActive: false,
    },
  ];

  const [adminUser] = await db
    .insert(users)
    .values(userValues)
    .onConflictDoNothing()
    .returning();

  const admin =
    adminUser ??
    (await db.query.users.findFirst({
      where: (u, { eq, and }) =>
        and(
          eq(u.organizationId, organizationId),
          eq(u.email, config.users.admin.email),
        ),
    }));

  if (!admin) {
    console.error("  Failed to create/find admin user");
    return;
  }
  console.log(`  Created/found users (admin: ${admin.email})`);

  // 3. Create Medusa connector
  const medusaConnector = await createConnectorWithTools(
    db,
    organizationId,
    catalogs.medusa,
    config.ecommerce.connectorName,
    config.ecommerce.connectorSlug,
    config.ecommerce.config,
    config.org.slug,
  );

  // 4. Create Zendesk connector
  const zendeskConnector = await createConnectorWithTools(
    db,
    organizationId,
    catalogs.zendesk,
    config.helpdesk.connectorName,
    config.helpdesk.connectorSlug,
    config.helpdesk.config,
    config.org.slug,
  );

  // 5. Create agents
  const createdAgents: { id: string; name: string }[] = [];
  for (const def of config.agents) {
    const [agent] = await db
      .insert(agents)
      .values({
        organizationId,
        name: def.name,
        slug: def.slug,
        description: def.description,
        modality: def.modality ?? "voice",
        isActive: true,
        createdBy: admin.id,
      })
      .onConflictDoNothing()
      .returning();

    const found =
      agent ??
      (await db.query.agents.findFirst({
        where: (a, { eq, and }) =>
          and(eq(a.organizationId, organizationId), eq(a.name, def.name)),
      }));

    if (found) {
      createdAgents.push({ id: found.id, name: found.name });
      console.log(`  Created/found agent: ${found.name}`);
    }
  }

  // 6. Generate API keys for agents
  for (const agent of createdAgents) {
    const { key, hash, prefix } = generateApiKey();
    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        organizationId,
        agentId: agent.id,
        name: `${agent.name} Key`,
        keyHash: hash,
        keyPrefix: prefix,
        isActive: true,
        createdBy: admin.id,
      })
      .onConflictDoNothing()
      .returning();
    if (apiKey) {
      console.log(`  Created API key for ${agent.name}: ${key}`);
    } else {
      console.log(`  API key for ${agent.name} already exists (skipped)`);
    }
  }

  // 7. Link ALL tools from BOTH connectors to agents
  const allToolIds: string[] = [];
  if (medusaConnector) {
    const tools = await db.query.connectorTools.findMany({
      where: (t, { eq, and, isNull }) =>
        and(eq(t.connectorId, medusaConnector.id), isNull(t.deletedAt)),
    });
    allToolIds.push(...tools.map((t) => t.id));
  }
  if (zendeskConnector) {
    const tools = await db.query.connectorTools.findMany({
      where: (t, { eq, and, isNull }) =>
        and(eq(t.connectorId, zendeskConnector.id), isNull(t.deletedAt)),
    });
    allToolIds.push(...tools.map((t) => t.id));
  }

  // Look up all tools to check requiresConfirmation from catalog
  const allTools = await db.query.connectorTools.findMany({
    where: (t, { eq, and, isNull }) =>
      and(eq(t.organizationId, organizationId), isNull(t.deletedAt)),
  });
  const toolMap = new Map(allTools.map((t) => [t.id, t]));

  // Build a set of tool names that require confirmation from catalog
  const confirmationTools = new Set<string>();
  for (const catalog of [catalogs.medusa, catalogs.zendesk]) {
    if (Array.isArray(catalog.tools)) {
      for (const tool of catalog.tools as CatalogTool[]) {
        if (tool.defaultRequiresConfirmation) {
          confirmationTools.add(toolSlug(tool.name));
        }
      }
    }
  }

  for (const agent of createdAgents) {
    const linkValues = allToolIds.map((toolId) => {
      const tool = toolMap.get(toolId);
      const slug = tool?.slug ?? "";
      return {
        agentId: agent.id,
        connectorToolId: toolId,
        isEnabled: true,
        requiresConfirmation: confirmationTools.has(slug),
      };
    });

    if (linkValues.length > 0) {
      await db
        .insert(agentConnectorTools)
        .values(linkValues)
        .onConflictDoNothing();
    }
  }
  console.log(
    `  Linked ${allToolIds.length} tools to ${createdAgents.length} agents`,
  );

  // 8. Insert handwritten sessions
  if (createdAgents.length > 0 && config.handwrittenSessions.length > 0) {
    await insertHandwrittenSessions(db, organizationId, createdAgents, config);
  }

  // 9. Generate ~300 sessions
  if (createdAgents.length > 0) {
    await generateSessions(db, organizationId, createdAgents, config);
  }

  console.log(`  ${config.org.name} seed completed!`);
}

// ============================================================================
// Helpers
// ============================================================================

async function createConnectorWithTools(
  db: SeedDb,
  organizationId: string,
  catalog: CatalogEntry,
  connectorName: string,
  connectorSlug: string,
  connectorConfig: Record<string, string>,
  orgSlug: string,
): Promise<{ id: string } | null> {
  const [conn] = await db
    .insert(connectors)
    .values({
      organizationId,
      connectorCatalogId: catalog.id,
      name: connectorName,
      slug: connectorSlug,
      config: connectorConfig,
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const connector =
    conn ??
    (await db.query.connectors.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.organizationId, organizationId), eq(c.slug, connectorSlug)),
    }));

  if (!connector) {
    console.error(`  Failed to create/find connector ${connectorSlug}`);
    return null;
  }
  console.log(`  Created/found connector: ${connector.name}`);

  // Create secret
  const encrypted = await encryptSecret(
    `sk_${orgSlug}_${catalog.slug}_placeholder`,
  );
  await db
    .insert(secrets)
    .values({
      organizationId,
      name: `${connectorName} API Key`,
      secretType: "api_key",
      encryptedValue: encrypted,
      ownerType: "connector",
      ownerId: connector.id,
    })
    .onConflictDoNothing();

  // Create tools from catalog
  if (Array.isArray(catalog.tools)) {
    const toolValues = (catalog.tools as CatalogTool[]).map((tool) => ({
      organizationId,
      connectorId: connector.id,
      name: tool.name,
      slug: toolSlug(tool.name),
      description: tool.description,
      toolSchema: tool.inputSchema,
      timeoutSeconds: tool.defaultTimeoutSeconds || 30,
      isActive: true,
    }));

    const inserted = await db
      .insert(connectorTools)
      .values(toolValues)
      .onConflictDoNothing()
      .returning();
    console.log(`  Created ${inserted.length} tools for ${connectorName}`);
  }

  return { id: connector.id };
}

async function insertHandwrittenSessions(
  db: SeedDb,
  organizationId: string,
  createdAgents: { id: string; name: string }[],
  config: OrgVerticalConfig,
): Promise<void> {
  const now = Date.now();

  for (const sessionDef of config.handwrittenSessions) {
    const agentId = createdAgents[sessionDef.agentIndex]?.id;
    if (!agentId) continue;

    const startedAt = new Date(now - sessionDef.hoursAgo * 60 * 60 * 1000);
    const endedAt =
      sessionDef.status !== "active"
        ? new Date(
            startedAt.getTime() +
              (5 + Math.floor(Math.random() * 10)) * 60 * 1000,
          )
        : null;

    const [session] = await db
      .insert(sessions)
      .values({
        organizationId,
        agentId,
        channelType: sessionDef.channel,
        status: sessionDef.status,
        userIdentifier: sessionDef.userIdentifier,
        startedAt,
        endedAt,
      })
      .onConflictDoNothing()
      .returning();

    if (!session) continue;

    // Insert messages
    const messageValues = sessionDef.messages.map((msg, idx) => ({
      sessionId: session.id,
      role: msg.role,
      content: msg.content,
      createdAt: new Date(startedAt.getTime() + idx * 15000),
      occurredAt: new Date(startedAt.getTime() + idx * 15000),
    }));

    await db
      .insert(sessionMessages)
      .values(messageValues)
      .onConflictDoNothing();

    // Insert feedback
    if (sessionDef.feedback) {
      await db
        .insert(sessionFeedback)
        .values({
          sessionId: session.id,
          rating: sessionDef.feedback.rating,
          comment: sessionDef.feedback.comment,
          feedbackSource: sessionDef.feedback.source,
        })
        .onConflictDoNothing();
    }

    // Insert links
    if (sessionDef.links.length > 0) {
      await db
        .insert(sessionLinks)
        .values(
          sessionDef.links.map((link) => ({
            sessionId: session.id,
            url: link.url,
            title: link.title,
            connectorSlug: link.connectorSlug,
            resourceType: link.resourceType,
          })),
        )
        .onConflictDoNothing();
    }
  }

  console.log(
    `  Created ${config.handwrittenSessions.length} handwritten sessions`,
  );
}
