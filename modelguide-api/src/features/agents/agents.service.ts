/**
 * Agents service - business logic for agent management, API keys, and connector tool assignment
 */

import { forOrg } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
} from "@db/schema";
import { generateApiKey } from "@lib/crypto";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, eq, inArray } from "drizzle-orm";

// ============================================================================
// Core Agent CRUD
// ============================================================================

export async function listAgents(
  orgId: string,
  pagination: PaginationParams,
  filters?: { isActive?: boolean; agentType?: string },
) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (filters?.isActive !== undefined) {
      conditions.push(eq(agents.isActive, filters.isActive));
    }
    if (filters?.agentType) {
      conditions.push(eq(agents.agentType, filters.agentType as "voice"));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(agents)
        .where(where)
        .orderBy(asc(agents.createdAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(agents).where(where),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getAgentById(orgId: string, agentId: string) {
  const [agent] = await forOrg(orgId, (tx) =>
    tx.select().from(agents).where(eq(agents.id, agentId)),
  );

  if (!agent) {
    throw Errors.agentNotFound(agentId);
  }

  return agent;
}

export async function createAgent(
  orgId: string,
  data: {
    name: string;
    description?: string;
    agentType?: "voice";
    systemPrompt?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
  createdBy: string,
) {
  return forOrg(orgId, async (tx) => {
    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: orgId,
        name: data.name,
        description: data.description,
        agentType: data.agentType ?? "voice",
        isActive: false,
        systemPrompt: data.systemPrompt,
        tags: data.tags ?? [],
        metadata: data.metadata ?? {},
        createdBy,
      })
      .returning();

    const keyData = generateApiKey();

    await tx.insert(apiKeys).values({
      organizationId: orgId,
      agentId: agent.id,
      name: `${agent.name} API Key`,
      keyHash: keyData.hash,
      keyPrefix: keyData.prefix,
      isActive: true,
      createdBy,
    });

    return { agent, apiKey: keyData.key };
  });
}

export async function updateAgent(
  orgId: string,
  agentId: string,
  data: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
) {
  const [updated] = await forOrg(orgId, (tx) =>
    tx.update(agents).set(data).where(eq(agents.id, agentId)).returning(),
  );

  if (!updated) {
    throw Errors.agentNotFound(agentId);
  }

  return updated;
}

export async function deleteAgent(
  orgId: string,
  agentId: string,
): Promise<void> {
  const [deleted] = await forOrg(orgId, (tx) =>
    tx
      .delete(agents)
      .where(eq(agents.id, agentId))
      .returning({ id: agents.id }),
  );

  if (!deleted) {
    throw Errors.agentNotFound(agentId);
  }
}

// ============================================================================
// Activation
// ============================================================================

export async function setAgentActive(
  orgId: string,
  agentId: string,
  isActive: boolean,
) {
  const [updated] = await forOrg(orgId, (tx) =>
    tx
      .update(agents)
      .set({ isActive })
      .where(eq(agents.id, agentId))
      .returning(),
  );

  if (!updated) {
    throw Errors.agentNotFound(agentId);
  }

  return updated;
}

// ============================================================================
// API Key Management
// ============================================================================

export async function regenerateApiKey(
  orgId: string,
  agentId: string,
  createdBy: string,
) {
  await getAgentById(orgId, agentId);

  return forOrg(orgId, async (tx) => {
    await tx
      .update(apiKeys)
      .set({ isActive: false })
      .where(eq(apiKeys.agentId, agentId));

    const keyData = generateApiKey();

    await tx.insert(apiKeys).values({
      organizationId: orgId,
      agentId,
      name: "Regenerated API Key",
      keyHash: keyData.hash,
      keyPrefix: keyData.prefix,
      isActive: true,
      createdBy,
    });

    return { apiKey: keyData.key, keyPrefix: keyData.prefix };
  });
}

// ============================================================================
// Agent Connector Tools (Junction Table)
// ============================================================================

export async function listAgentConnectors(orgId: string, agentId: string) {
  await getAgentById(orgId, agentId);

  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({
        id: agentConnectorTools.id,
        connectorToolId: agentConnectorTools.connectorToolId,
        isEnabled: agentConnectorTools.isEnabled,
        requiresConfirmation: agentConnectorTools.requiresConfirmation,
        toolName: connectorTools.name,
        toolSlug: connectorTools.slug,
        connectorId: connectors.id,
        connectorSlug: connectors.slug,
        connectorName: connectors.name,
      })
      .from(agentConnectorTools)
      .innerJoin(
        connectorTools,
        eq(agentConnectorTools.connectorToolId, connectorTools.id),
      )
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .where(eq(agentConnectorTools.agentId, agentId))
      .orderBy(asc(connectors.name), asc(connectorTools.name)),
  );

  const grouped = new Map<
    string,
    {
      connectorId: string;
      connectorSlug: string;
      connectorName: string;
      tools: {
        id: string;
        name: string;
        slug: string;
        isEnabled: boolean;
        requiresConfirmation: boolean;
      }[];
    }
  >();

  for (const row of rows) {
    if (!grouped.has(row.connectorId)) {
      grouped.set(row.connectorId, {
        connectorId: row.connectorId,
        connectorSlug: row.connectorSlug,
        connectorName: row.connectorName,
        tools: [],
      });
    }
    grouped.get(row.connectorId)!.tools.push({
      id: row.id,
      name: row.toolName,
      slug: row.toolSlug,
      isEnabled: row.isEnabled,
      requiresConfirmation: row.requiresConfirmation,
    });
  }

  return Array.from(grouped.values());
}

export async function assignConnectorToAgent(
  orgId: string,
  agentId: string,
  data: {
    connectorId: string;
    tools: {
      name: string;
      isEnabled?: boolean;
      requiresConfirmation?: boolean;
    }[];
  },
) {
  await getAgentById(orgId, agentId);

  return forOrg(orgId, async (tx) => {
    const [connector] = await tx
      .select()
      .from(connectors)
      .where(eq(connectors.id, data.connectorId));

    if (!connector) {
      throw Errors.connectorNotFound(data.connectorId);
    }

    const toolSlugs = data.tools.map((t) => t.name);
    const existingTools = await tx
      .select()
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, data.connectorId),
          inArray(connectorTools.slug, toolSlugs),
        ),
      );

    if (existingTools.length !== toolSlugs.length) {
      const foundSlugs = new Set(existingTools.map((t) => t.slug));
      const missing = toolSlugs.filter((s) => !foundSlugs.has(s));
      throw Errors.notFound("Connector tools", missing.join(", "));
    }

    const settingsBySlug = new Map(data.tools.map((t) => [t.name, t]));

    const values = existingTools.map((tool) => {
      const settings = settingsBySlug.get(tool.slug)!;
      return {
        agentId,
        connectorToolId: tool.id,
        isEnabled: settings.isEnabled ?? true,
        requiresConfirmation: settings.requiresConfirmation ?? false,
      };
    });

    try {
      await tx.insert(agentConnectorTools).values(values);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("agent_connector_tools_unique")
      ) {
        throw Errors.alreadyExists("Agent connector tool assignment");
      }
      throw err;
    }

    return { assigned: values.length };
  });
}

export async function updateAgentConnectorTools(
  orgId: string,
  agentId: string,
  connectorId: string,
  data: {
    tools: {
      name: string;
      isEnabled?: boolean;
      requiresConfirmation?: boolean;
    }[];
  },
) {
  await getAgentById(orgId, agentId);

  return forOrg(orgId, async (tx) => {
    const cTools = await tx
      .select()
      .from(connectorTools)
      .where(eq(connectorTools.connectorId, connectorId));

    const slugToId = new Map(cTools.map((t) => [t.slug, t.id]));
    let updatedCount = 0;

    for (const tool of data.tools) {
      const connectorToolId = slugToId.get(tool.name);
      if (!connectorToolId) {
        throw Errors.toolNotFound(tool.name);
      }

      const setValues: { isEnabled?: boolean; requiresConfirmation?: boolean } =
        {};
      if (tool.isEnabled !== undefined) setValues.isEnabled = tool.isEnabled;
      if (tool.requiresConfirmation !== undefined)
        setValues.requiresConfirmation = tool.requiresConfirmation;

      if (Object.keys(setValues).length > 0) {
        await tx
          .update(agentConnectorTools)
          .set(setValues)
          .where(
            and(
              eq(agentConnectorTools.agentId, agentId),
              eq(agentConnectorTools.connectorToolId, connectorToolId),
            ),
          );
        updatedCount++;
      }
    }

    return { updated: updatedCount };
  });
}

export async function removeConnectorFromAgent(
  orgId: string,
  agentId: string,
  connectorId: string,
): Promise<void> {
  await getAgentById(orgId, agentId);

  await forOrg(orgId, async (tx) => {
    const cTools = await tx
      .select({ id: connectorTools.id })
      .from(connectorTools)
      .where(eq(connectorTools.connectorId, connectorId));

    if (cTools.length === 0) return;

    await tx.delete(agentConnectorTools).where(
      and(
        eq(agentConnectorTools.agentId, agentId),
        inArray(
          agentConnectorTools.connectorToolId,
          cTools.map((t) => t.id),
        ),
      ),
    );
  });
}
