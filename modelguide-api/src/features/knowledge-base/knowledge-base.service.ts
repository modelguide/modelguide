/**
 * Knowledge Base service — CRUD operations for guardrails (and future KB types).
 */

import { type Transaction, forOrg } from "@db/rls";
import { agentKnowledgeBase, agents, knowledgeBase } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { slugify } from "@lib/slugify";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

// ============================================================================
// Helpers
// ============================================================================

interface AgentInfo {
  id: string;
  name: string;
}

/** Batch-load agent assignments for a list of KB item IDs. */
async function batchLoadAgentAssignments(
  tx: Transaction,
  kbIds: string[],
): Promise<Map<string, AgentInfo[]>> {
  const map = new Map<string, AgentInfo[]>();
  if (kbIds.length === 0) return map;

  const rows = await tx
    .select({
      knowledgeBaseId: agentKnowledgeBase.knowledgeBaseId,
      id: agents.id,
      name: agents.name,
    })
    .from(agentKnowledgeBase)
    .innerJoin(agents, eq(agentKnowledgeBase.agentId, agents.id))
    .where(inArray(agentKnowledgeBase.knowledgeBaseId, kbIds));

  for (const r of rows) {
    const list = map.get(r.knowledgeBaseId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.knowledgeBaseId, list);
  }
  return map;
}

/** Sync agent assignments: delete existing, insert new. */
async function setAgentsInternal(
  tx: Transaction,
  kbId: string,
  agentIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(agentIds)];

  if (uniqueIds.length > 0) {
    const found = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(inArray(agents.id, uniqueIds));
    const foundSet = new Set(found.map((a) => a.id));
    for (const id of uniqueIds) {
      if (!foundSet.has(id)) throw Errors.agentNotFound(id);
    }
  }

  await tx
    .delete(agentKnowledgeBase)
    .where(eq(agentKnowledgeBase.knowledgeBaseId, kbId));

  if (uniqueIds.length > 0) {
    await tx.insert(agentKnowledgeBase).values(
      uniqueIds.map((agentId) => ({
        agentId,
        knowledgeBaseId: kbId,
      })),
    );
  }
}

// ============================================================================
// CRUD
// ============================================================================

export async function listKnowledgeBase(
  orgId: string,
  params: {
    type?: "guardrail";
    isActive?: boolean;
    agentId?: string;
    category?: string;
  } & PaginationParams,
) {
  const { page, pageSize, type, isActive, agentId, category } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (type) conditions.push(eq(knowledgeBase.type, type));
    if (isActive !== undefined)
      conditions.push(eq(knowledgeBase.isActive, isActive));
    if (category)
      conditions.push(sql`${knowledgeBase.config}->>'category' = ${category}`);

    // Filter by agent assignment
    let kbIdsForAgent: string[] | undefined;
    if (agentId) {
      const rows = await tx
        .select({ knowledgeBaseId: agentKnowledgeBase.knowledgeBaseId })
        .from(agentKnowledgeBase)
        .where(eq(agentKnowledgeBase.agentId, agentId));
      kbIdsForAgent = rows.map((r) => r.knowledgeBaseId);
      if (kbIdsForAgent.length === 0) {
        return {
          data: [],
          pagination: buildPaginationMeta(page, pageSize, 0),
        };
      }
      conditions.push(inArray(knowledgeBase.id, kbIdsForAgent));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(knowledgeBase)
        .where(where)
        .orderBy(
          desc(
            sql`COALESCE(${knowledgeBase.updatedAt}, ${knowledgeBase.createdAt})`,
          ),
        )
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(knowledgeBase).where(where),
    ]);

    const assignmentsMap = await batchLoadAgentAssignments(
      tx,
      items.map((i) => i.id),
    );

    const data = items.map((item) => ({
      ...item,
      assignedAgents: assignmentsMap.get(item.id) ?? [],
    }));

    return {
      data,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getKnowledgeBaseById(orgId: string, id: string) {
  return forOrg(orgId, async (tx) => {
    const [item] = await tx
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, id));

    if (!item) throw Errors.knowledgeBaseNotFound(id);

    const assignmentsMap = await batchLoadAgentAssignments(tx, [item.id]);

    return {
      ...item,
      assignedAgents: assignmentsMap.get(item.id) ?? [],
    };
  });
}

export async function createKnowledgeBase(
  orgId: string,
  data: {
    type: "guardrail";
    name: string;
    slug?: string;
    content: string;
    description?: string;
    config: Record<string, unknown>;
    isActive?: boolean;
    agentIds?: string[];
    createdBy?: string;
  },
) {
  const slug = data.slug || slugify(data.name);

  return forOrg(orgId, async (tx) => {
    // Check slug uniqueness within org+type
    const [existing] = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(
        and(eq(knowledgeBase.type, data.type), eq(knowledgeBase.slug, slug)),
      );

    if (existing) throw Errors.knowledgeBaseSlugExists(slug);

    const [created] = await tx
      .insert(knowledgeBase)
      .values({
        organizationId: orgId,
        type: data.type,
        name: data.name,
        slug,
        content: data.content,
        description: data.description,
        config: data.config,
        isActive: data.isActive ?? true,
        createdBy: data.createdBy,
      })
      .returning();

    if (data.agentIds && data.agentIds.length > 0) {
      await setAgentsInternal(tx, created.id, data.agentIds);
    }

    const assignmentsMap = await batchLoadAgentAssignments(tx, [created.id]);

    return {
      ...created,
      assignedAgents: assignmentsMap.get(created.id) ?? [],
    };
  });
}

export async function updateKnowledgeBase(
  orgId: string,
  id: string,
  data: {
    name?: string;
    content?: string;
    description?: string | null;
    config?: Record<string, unknown>;
    isActive?: boolean;
    agentIds?: string[];
  },
) {
  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, id));

    if (!existing) throw Errors.knowledgeBaseNotFound(id);

    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.content !== undefined) updates.content = data.content;
    if (data.description !== undefined) updates.description = data.description;
    if (data.config !== undefined) updates.config = data.config;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    // Always bump updatedAt when agent assignments change
    if (data.agentIds !== undefined) {
      updates.updatedAt = new Date();
    }

    if (Object.keys(updates).length > 0) {
      await tx
        .update(knowledgeBase)
        .set(updates)
        .where(eq(knowledgeBase.id, id));
    }

    if (data.agentIds !== undefined) {
      await setAgentsInternal(tx, id, data.agentIds);
    }

    // Re-fetch with assignments
    const [updated] = await tx
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, id));

    const assignmentsMap = await batchLoadAgentAssignments(tx, [id]);

    return {
      ...updated,
      assignedAgents: assignmentsMap.get(id) ?? [],
    };
  });
}

export async function deleteKnowledgeBase(
  orgId: string,
  id: string,
): Promise<void> {
  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, id));

    if (!existing) throw Errors.knowledgeBaseNotFound(id);

    await tx.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
  });
}
