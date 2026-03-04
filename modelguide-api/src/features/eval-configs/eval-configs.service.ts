/**
 * Eval configs service — CRUD for reusable evaluator definitions.
 */

import { forOrg } from "@db/rls";
import { evalConfigs, sopSteps } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, count, eq } from "drizzle-orm";

// ============================================================================
// Queries
// ============================================================================

export async function listEvalConfigs(
  orgId: string,
  params: { evaluatorType?: string } & PaginationParams,
) {
  const { page, pageSize, evaluatorType } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (evaluatorType) {
      conditions.push(
        eq(
          evalConfigs.evaluatorType,
          evaluatorType as
            | "tool_called"
            | "tool_input_contains"
            | "no_tool_called"
            | "llm_judge",
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(evalConfigs)
        .where(where)
        .orderBy(evalConfigs.createdAt)
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(evalConfigs).where(where),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getEvalConfigById(orgId: string, configId: string) {
  return forOrg(orgId, async (tx) => {
    const [config] = await tx
      .select()
      .from(evalConfigs)
      .where(eq(evalConfigs.id, configId));

    if (!config) {
      throw Errors.evalConfigNotFound(configId);
    }

    return config;
  });
}

// ============================================================================
// Mutations
// ============================================================================

export async function createEvalConfig(
  orgId: string,
  data: {
    name: string;
    description?: string;
    evaluatorType: string;
    config: Record<string, unknown>;
  },
  createdBy?: string,
) {
  return forOrg(orgId, async (tx) => {
    const [config] = await tx
      .insert(evalConfigs)
      .values({
        organizationId: orgId,
        name: data.name,
        description: data.description,
        evaluatorType: data.evaluatorType as
          | "tool_called"
          | "tool_input_contains"
          | "no_tool_called"
          | "llm_judge",
        config: data.config,
        createdBy,
      })
      .returning();

    return config;
  });
}

export async function updateEvalConfig(
  orgId: string,
  configId: string,
  data: {
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
  },
) {
  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: evalConfigs.id, evaluatorType: evalConfigs.evaluatorType })
      .from(evalConfigs)
      .where(eq(evalConfigs.id, configId));

    if (!existing) {
      throw Errors.evalConfigNotFound(configId);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.config !== undefined) updateData.config = data.config;

    const [updated] = await tx
      .update(evalConfigs)
      .set(updateData)
      .where(eq(evalConfigs.id, configId))
      .returning();

    return updated;
  });
}

export async function deleteEvalConfig(
  orgId: string,
  configId: string,
): Promise<void> {
  await forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: evalConfigs.id })
      .from(evalConfigs)
      .where(eq(evalConfigs.id, configId));

    if (!existing) {
      throw Errors.evalConfigNotFound(configId);
    }

    // Check if any SOP steps reference this eval config
    const [{ total }] = await tx
      .select({ total: count() })
      .from(sopSteps)
      .where(eq(sopSteps.evalConfigId, configId));

    if (total > 0) {
      throw Errors.evalConfigInUse(configId, total);
    }

    await tx.delete(evalConfigs).where(eq(evalConfigs.id, configId));
  });
}
