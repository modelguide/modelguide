/**
 * SOPs service — business logic for SOP templates, definitions, versions, and agent assignments.
 */

import { db } from "@db/client";
import { type Transaction, forOrg } from "@db/rls";
import {
  agentSops,
  agents,
  connectorTools,
  connectors,
  sopTemplates,
  sopVersions,
  sops,
} from "@db/schema";
import type { NewSop } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { SopSchema, SopStep } from "./sops.types";

// ============================================================================
// Helpers
// ============================================================================

/** Generate a slug from a name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Validate step IDs are unique within an SOP. */
function validateUniqueStepIds(steps: SopStep[]): void {
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw Errors.validationError(`Duplicate step ID: "${step.id}"`);
    }
    ids.add(step.id);
  }
}

/** Normalize step order to be 1-based from array position. */
function normalizeStepOrder(steps: SopStep[]): SopStep[] {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

// ============================================================================
// Step connector/tool validation and name resolution
// ============================================================================

/**
 * Validate that step tool references point to valid org connectors and tools.
 * Also computes and sets `resolvedName` on each step with a tool reference.
 *
 * Accepts a transaction so callers can run this inside their forOrg block,
 * avoiding TOCTOU races between validation and insert.
 */
async function validateAndResolveSteps(
  tx: Transaction,
  steps: SopStep[],
): Promise<SopStep[]> {
  const stepsWithTools = steps.filter((s) => s.tool?.connectorId);
  if (stepsWithTools.length === 0) return steps;

  // Collect unique connector IDs
  const connectorIds = [
    ...new Set(stepsWithTools.map((s) => s.tool!.connectorId!)),
  ];

  // Look up connectors within org scope (tx already has org context)
  const orgConnectors = await tx
    .select({ id: connectors.id, slug: connectors.slug })
    .from(connectors)
    .where(inArray(connectors.id, connectorIds));

  const connectorMap = new Map(orgConnectors.map((c) => [c.id, c.slug]));

  // Verify all referenced connectors exist in this org
  for (const cid of connectorIds) {
    if (!connectorMap.has(cid)) {
      throw Errors.sopInvalidConnectorRef(
        `Connector not found in this organization: ${cid}`,
      );
    }
  }

  // Look up connector tools to validate toolSlug references
  const orgTools = await tx
    .select({
      connectorId: connectorTools.connectorId,
      slug: connectorTools.slug,
    })
    .from(connectorTools)
    .where(
      and(
        inArray(connectorTools.connectorId, connectorIds),
        isNull(connectorTools.deletedAt),
      ),
    );

  const toolSet = new Set(orgTools.map((t) => `${t.connectorId}:${t.slug}`));

  // Validate and resolve each step
  return steps.map((step) => {
    if (!step.tool?.connectorId) return step;

    const key = `${step.tool.connectorId}:${step.tool.toolSlug}`;
    if (!toolSet.has(key)) {
      throw Errors.sopInvalidConnectorRef(
        `Tool "${step.tool.toolSlug}" not found on connector ${step.tool.connectorId}`,
      );
    }

    const connectorSlug = connectorMap.get(step.tool.connectorId)!;
    return {
      ...step,
      tool: {
        ...step.tool,
        resolvedName: `${connectorSlug}_${step.tool.toolSlug}`,
      },
    };
  });
}

// ============================================================================
// Templates (global catalog — no RLS)
// ============================================================================

export async function listTemplates(pagination: PaginationParams) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(sopTemplates)
      .where(eq(sopTemplates.isActive, true))
      .orderBy(asc(sopTemplates.name))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(sopTemplates)
      .where(eq(sopTemplates.isActive, true)),
  ]);

  return {
    data: items,
    pagination: buildPaginationMeta(page, pageSize, total),
  };
}

export async function getTemplateById(templateId: string) {
  const [template] = await db
    .select()
    .from(sopTemplates)
    .where(eq(sopTemplates.id, templateId));

  if (!template) {
    throw Errors.sopTemplateNotFound(templateId);
  }

  return template;
}

// ============================================================================
// SOPs (org-scoped via forOrg)
// ============================================================================

export async function listSops(
  orgId: string,
  params: {
    status?: "draft" | "active" | "archived";
    category?: string;
    agentId?: string;
  } & PaginationParams,
) {
  const { page, pageSize, status, category, agentId } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    // Build conditions
    const conditions = [];
    if (status) conditions.push(eq(sops.status, status));
    if (category) conditions.push(eq(sops.category, category));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // If filtering by agent, get SOP IDs first
    let sopIdsForAgent: string[] | undefined;
    if (agentId) {
      const agentSopRows = await tx
        .select({ sopId: agentSops.sopId })
        .from(agentSops)
        .where(eq(agentSops.agentId, agentId));
      sopIdsForAgent = agentSopRows.map((r) => r.sopId);
      if (sopIdsForAgent.length === 0) {
        return {
          data: [],
          pagination: buildPaginationMeta(page, pageSize, 0),
        };
      }
    }

    const agentFilter = sopIdsForAgent
      ? inArray(sops.id, sopIdsForAgent)
      : undefined;
    const allConditions =
      where && agentFilter
        ? and(where, agentFilter)
        : (where ?? agentFilter ?? undefined);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(sops)
        .where(allConditions)
        .orderBy(desc(sops.updatedAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(sops).where(allConditions),
    ]);

    // Batch-load all agent assignments for these SOPs (fix N+1)
    const allSopIds = items.map((s) => s.id);
    const allAssignments =
      allSopIds.length > 0
        ? await tx
            .select({
              sopId: agentSops.sopId,
              id: agents.id,
              name: agents.name,
              modality: agents.modality,
            })
            .from(agentSops)
            .innerJoin(agents, eq(agentSops.agentId, agents.id))
            .where(inArray(agentSops.sopId, allSopIds))
        : [];

    const assignmentsBySop = new Map<
      string,
      { id: string; name: string; modality: string }[]
    >();
    for (const a of allAssignments) {
      const list = assignmentsBySop.get(a.sopId) ?? [];
      list.push({ id: a.id, name: a.name, modality: a.modality });
      assignmentsBySop.set(a.sopId, list);
    }

    // Batch-load template names
    const templateIds = [
      ...new Set(items.filter((s) => s.templateId).map((s) => s.templateId!)),
    ];
    const templateRows =
      templateIds.length > 0
        ? await db
            .select({ id: sopTemplates.id, name: sopTemplates.name })
            .from(sopTemplates)
            .where(inArray(sopTemplates.id, templateIds))
        : [];
    const templateNameMap = new Map(templateRows.map((t) => [t.id, t.name]));

    const enriched = items.map((sop) => {
      const def = sop.definition as unknown as SopSchema;
      return {
        ...sop,
        assignedAgents: assignmentsBySop.get(sop.id) ?? [],
        templateName: sop.templateId
          ? (templateNameMap.get(sop.templateId) ?? null)
          : null,
        stepCount: def?.steps?.length ?? 0,
      };
    });

    return {
      data: enriched,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getSopById(orgId: string, sopId: string) {
  return forOrg(orgId, async (tx) => {
    const [sop] = await tx.select().from(sops).where(eq(sops.id, sopId));

    if (!sop) {
      throw Errors.sopNotFound(sopId);
    }

    // Agent assignments (agentSops has no RLS; agents is RLS-protected so tx filters by org)
    const assignedAgents = await tx
      .select({
        id: agents.id,
        name: agents.name,
        modality: agents.modality,
      })
      .from(agentSops)
      .innerJoin(agents, eq(agentSops.agentId, agents.id))
      .where(eq(agentSops.sopId, sopId));

    // Template lookup (no RLS — global table)
    let template: { id: string; name: string; slug: string } | null = null;
    if (sop.templateId) {
      const [tpl] = await db
        .select({
          id: sopTemplates.id,
          name: sopTemplates.name,
          slug: sopTemplates.slug,
        })
        .from(sopTemplates)
        .where(eq(sopTemplates.id, sop.templateId));
      template = tpl ?? null;
    }

    // Compute step warnings for inactive tools/connectors (inside same tx)
    const def = sop.definition as unknown as SopSchema;
    const stepWarnings = await computeStepWarningsInTx(tx, def?.steps ?? []);

    return { ...sop, assignedAgents, template, stepWarnings };
  });
}

export async function createSop(
  orgId: string,
  data: {
    name: string;
    slug?: string;
    description?: string;
    category?: string;
    definition: SopSchema;
    agentIds?: string[];
  },
  createdBy?: string,
) {
  const slug = data.slug || slugify(data.name);
  const steps = normalizeStepOrder(data.definition.steps);
  validateUniqueStepIds(steps);

  return forOrg(orgId, async (tx) => {
    // Validate and resolve step tool references inside the transaction
    const resolvedSteps = await validateAndResolveSteps(tx, steps);

    const definition: SopSchema = {
      ...data.definition,
      steps: resolvedSteps,
    };

    // Check slug uniqueness
    const [existing] = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.slug, slug));

    if (existing) {
      throw Errors.sopSlugExists(slug);
    }

    const [sop] = await tx
      .insert(sops)
      .values({
        organizationId: orgId,
        name: data.name,
        slug,
        description: data.description,
        category: data.category,
        definition: definition as unknown as Record<string, unknown>,
        status: "draft",
        createdBy,
      })
      .returning();

    // Assign agents if provided
    if (data.agentIds?.length) {
      await setAssignedAgentsInternal(tx, sop.id, data.agentIds);
    }

    return sop;
  });
}

export async function forkFromTemplate(
  orgId: string,
  templateId: string,
  data: {
    name?: string;
    slug?: string;
    connectorMapping: Record<string, string>;
    agentIds?: string[];
    overrides?: Pick<Partial<SopSchema>, "trigger" | "metadata">;
  },
  createdBy?: string,
) {
  const template = await getTemplateById(templateId);
  const templateDef = template.definition as unknown as SopSchema;

  const name = data.name || template.name;
  const slug = data.slug || slugify(name);

  // Rewrite step tool references: catalogSlug → connectorId
  let steps = (templateDef.steps ?? []).map((step) => {
    if (!step.tool?.catalogSlug) return step;

    const connectorId = data.connectorMapping[step.tool.catalogSlug];
    if (!connectorId) {
      throw Errors.sopInvalidConnectorRef(
        `No connector mapping provided for catalog slug "${step.tool.catalogSlug}"`,
      );
    }

    return {
      ...step,
      tool: {
        ...step.tool,
        connectorId,
        catalogSlug: undefined,
      },
    };
  });

  steps = normalizeStepOrder(steps);
  validateUniqueStepIds(steps);

  return forOrg(orgId, async (tx) => {
    // Validate and resolve inside the transaction
    const resolvedSteps = await validateAndResolveSteps(tx, steps);

    const definition: SopSchema = {
      schemaVersion: 1,
      trigger: data.overrides?.trigger ?? templateDef.trigger,
      steps: resolvedSteps,
      metadata: data.overrides?.metadata ?? templateDef.metadata ?? {},
    };

    const [existing] = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.slug, slug));

    if (existing) {
      throw Errors.sopSlugExists(slug);
    }

    const [sop] = await tx
      .insert(sops)
      .values({
        organizationId: orgId,
        templateId,
        name,
        slug,
        description: template.description,
        category: template.category,
        definition: definition as unknown as Record<string, unknown>,
        status: "draft",
        createdBy,
      })
      .returning();

    if (data.agentIds?.length) {
      await setAssignedAgentsInternal(tx, sop.id, data.agentIds);
    }

    return sop;
  });
}

export async function updateSop(
  orgId: string,
  sopId: string,
  data: {
    name?: string;
    description?: string;
    category?: string;
    definition?: SopSchema;
    version?: string;
  },
) {
  const updateData: Partial<NewSop> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.version !== undefined) updateData.version = data.version;

  return forOrg(orgId, async (tx) => {
    if (data.definition) {
      const steps = normalizeStepOrder(data.definition.steps);
      validateUniqueStepIds(steps);
      const resolvedSteps = await validateAndResolveSteps(tx, steps);
      const definition: SopSchema = {
        ...data.definition,
        steps: resolvedSteps,
      };
      updateData.definition = definition as unknown as Record<string, unknown>;
    }

    const [updated] = await tx
      .update(sops)
      .set(updateData)
      .where(eq(sops.id, sopId))
      .returning();

    if (!updated) {
      throw Errors.sopNotFound(sopId);
    }

    return updated;
  });
}

export async function deleteSop(orgId: string, sopId: string): Promise<void> {
  const [deleted] = await forOrg(orgId, (tx) =>
    tx.delete(sops).where(eq(sops.id, sopId)).returning({ id: sops.id }),
  );

  if (!deleted) {
    throw Errors.sopNotFound(sopId);
  }
}

export async function activateSop(orgId: string, sopId: string) {
  return forOrg(orgId, async (tx) => {
    const [sop] = await tx
      .select({ id: sops.id, definition: sops.definition })
      .from(sops)
      .where(eq(sops.id, sopId));

    if (!sop) {
      throw Errors.sopNotFound(sopId);
    }

    const def = sop.definition as unknown as SopSchema;
    if (!def?.steps?.length) {
      throw Errors.validationError(
        "Cannot activate SOP with no steps. Add at least one step first.",
      );
    }

    const [updated] = await tx
      .update(sops)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(sops.id, sopId))
      .returning();

    return updated!;
  });
}

export async function archiveSop(orgId: string, sopId: string) {
  const [updated] = await forOrg(orgId, (tx) =>
    tx
      .update(sops)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(sops.id, sopId))
      .returning(),
  );

  if (!updated) {
    throw Errors.sopNotFound(sopId);
  }

  return updated;
}

// ============================================================================
// Agent assignment
// ============================================================================

/** Internal helper — query agent assignments within provided tx. */
async function getAssignedAgentsInTx(tx: Transaction, sopId: string) {
  return tx
    .select({
      id: agents.id,
      name: agents.name,
      modality: agents.modality,
    })
    .from(agentSops)
    .innerJoin(agents, eq(agentSops.agentId, agents.id))
    .where(eq(agentSops.sopId, sopId));
}

/** Internal helper — verify agents belong to org and set assignments. */
async function setAssignedAgentsInternal(
  tx: Transaction,
  sopId: string,
  agentIds: string[],
) {
  // Verify all agents belong to this org (agents table is RLS-protected,
  // so querying inside forOrg only returns same-org agents)
  if (agentIds.length > 0) {
    const foundAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(inArray(agents.id, agentIds));

    const foundIds = new Set(foundAgents.map((a) => a.id));
    for (const id of agentIds) {
      if (!foundIds.has(id)) {
        throw Errors.agentNotFound(id);
      }
    }
  }

  // Delete existing assignments
  await tx.delete(agentSops).where(eq(agentSops.sopId, sopId));

  // Insert new
  if (agentIds.length > 0) {
    await tx.insert(agentSops).values(
      agentIds.map((agentId) => ({
        agentId,
        sopId,
      })),
    );
  }
}

export async function getAssignedAgents(orgId: string, sopId: string) {
  return forOrg(orgId, async (tx) => {
    // Verify SOP belongs to org
    const [sop] = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.id, sopId));

    if (!sop) {
      throw Errors.sopNotFound(sopId);
    }

    return getAssignedAgentsInTx(tx, sopId);
  });
}

export async function setAssignedAgents(
  orgId: string,
  sopId: string,
  agentIds: string[],
) {
  return forOrg(orgId, async (tx) => {
    // Verify SOP exists
    const [sop] = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.id, sopId));

    if (!sop) {
      throw Errors.sopNotFound(sopId);
    }

    await setAssignedAgentsInternal(tx, sopId, agentIds);

    return getAssignedAgentsInTx(tx, sopId);
  });
}

// ============================================================================
// Versions
// ============================================================================

export async function listVersions(orgId: string, sopId: string) {
  // Verify SOP belongs to org
  const [sop] = await forOrg(orgId, (tx) =>
    tx.select({ id: sops.id }).from(sops).where(eq(sops.id, sopId)),
  );

  if (!sop) {
    throw Errors.sopNotFound(sopId);
  }

  return db
    .select()
    .from(sopVersions)
    .where(eq(sopVersions.sopId, sopId))
    .orderBy(desc(sopVersions.createdAt));
}

export async function createVersion(
  orgId: string,
  sopId: string,
  data: { changeSummary?: string },
  createdBy?: string,
) {
  // Get current SOP (verifies org access)
  const [sop] = await forOrg(orgId, (tx) =>
    tx.select().from(sops).where(eq(sops.id, sopId)),
  );

  if (!sop) {
    throw Errors.sopNotFound(sopId);
  }

  const [version] = await db
    .insert(sopVersions)
    .values({
      sopId,
      version: sop.version,
      definition: sop.definition,
      changeSummary: data.changeSummary,
      createdBy,
    })
    .returning();

  return version;
}

export async function getVersion(
  orgId: string,
  sopId: string,
  versionId: string,
) {
  // Security: always resolve parent sopId within forOrg first,
  // then filter sop_versions by that sopId — never query by versionId alone.
  // This prevents cross-tenant access.
  const [sop] = await forOrg(orgId, (tx) =>
    tx.select({ id: sops.id }).from(sops).where(eq(sops.id, sopId)),
  );

  if (!sop) {
    throw Errors.sopNotFound(sopId);
  }

  const [version] = await db
    .select()
    .from(sopVersions)
    .where(and(eq(sopVersions.id, versionId), eq(sopVersions.sopId, sopId)));

  if (!version) {
    throw Errors.notFound("SOP version", versionId);
  }

  return version;
}

// ============================================================================
// Step warnings (inactive tool/connector detection)
// ============================================================================

/** Compute step warnings using a provided transaction (avoids extra forOrg calls). */
async function computeStepWarningsInTx(tx: Transaction, steps: SopStep[]) {
  const warnings: { stepId: string; message: string }[] = [];
  const stepsWithTools = steps.filter((s) => s.tool?.connectorId);
  if (stepsWithTools.length === 0) return warnings;

  const connectorIds = [
    ...new Set(stepsWithTools.map((s) => s.tool!.connectorId!)),
  ];

  // Look up connector + tool status in a single transaction
  const [orgConnectors, orgTools] = await Promise.all([
    tx
      .select({
        id: connectors.id,
        slug: connectors.slug,
        isActive: connectors.isActive,
      })
      .from(connectors)
      .where(inArray(connectors.id, connectorIds)),
    tx
      .select({
        connectorId: connectorTools.connectorId,
        slug: connectorTools.slug,
        isActive: connectorTools.isActive,
      })
      .from(connectorTools)
      .where(
        and(
          inArray(connectorTools.connectorId, connectorIds),
          isNull(connectorTools.deletedAt),
        ),
      ),
  ]);

  const connectorMap = new Map(orgConnectors.map((c) => [c.id, c]));
  const toolMap = new Map(
    orgTools.map((t) => [`${t.connectorId}:${t.slug}`, t]),
  );

  for (const step of stepsWithTools) {
    const cid = step.tool!.connectorId!;
    const connector = connectorMap.get(cid);

    if (!connector) {
      warnings.push({
        stepId: step.id,
        message: `Connector ${cid} no longer exists`,
      });
      continue;
    }

    if (!connector.isActive) {
      warnings.push({
        stepId: step.id,
        message: `Connector "${connector.slug}" is currently inactive`,
      });
    }

    const tool = toolMap.get(`${cid}:${step.tool!.toolSlug}`);
    if (!tool) {
      warnings.push({
        stepId: step.id,
        message: `Tool "${step.tool!.toolSlug}" no longer exists on connector "${connector.slug}"`,
      });
    } else if (!tool.isActive) {
      warnings.push({
        stepId: step.id,
        message: `Tool "${step.tool!.toolSlug}" is currently inactive on connector "${connector.slug}"`,
      });
    }
  }

  return warnings;
}
