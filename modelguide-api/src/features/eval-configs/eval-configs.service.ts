/**
 * Eval configs service — CRUD for reusable evaluator definitions.
 */

import { forOrg } from "@db/rls";
import { evalConfigs, sopSteps, sops } from "@db/schema";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, arrayContains, count, eq, inArray } from "drizzle-orm";
import type { EvaluatorType } from "../evals/evals.types";
import { validateEvalConfig } from "./eval-configs.schemas";

const log = getLogger();

// ============================================================================
// Queries
// ============================================================================

export async function listEvalConfigs(
  orgId: string,
  params: { evaluatorType?: string; tag?: string } & PaginationParams,
) {
  const { page, pageSize, evaluatorType, tag } = params;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = [];
    if (evaluatorType) {
      conditions.push(
        eq(evalConfigs.evaluatorType, evaluatorType as EvaluatorType),
      );
    }
    if (tag) {
      conditions.push(arrayContains(evalConfigs.tags, [tag]));
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
    tags?: string[];
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
        evaluatorType: data.evaluatorType as EvaluatorType,
        config: data.config,
        tags: data.tags ?? [],
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
    tags?: string[];
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

    // Validate config against the existing evaluator type
    if (data.config !== undefined) {
      const issues = validateEvalConfig(existing.evaluatorType, data.config);
      if (issues.length > 0) {
        const details = issues.map((i) => i.message).join("; ");
        throw Errors.validationError(
          `Invalid config for evaluator type "${existing.evaluatorType}": ${details}`,
        );
      }
    }

    const [updated] = await tx
      .update(evalConfigs)
      .set(data)
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
    const referencingSteps = await tx
      .select({ sopId: sopSteps.sopId, stepId: sopSteps.stepId })
      .from(sopSteps)
      .where(eq(sopSteps.evalConfigId, configId));

    if (referencingSteps.length > 0) {
      const sopIds = [...new Set(referencingSteps.map((s) => s.sopId))];
      const referencingSops = await tx
        .select({ id: sops.id, name: sops.name })
        .from(sops)
        .where(inArray(sops.id, sopIds));

      const sopNames = referencingSops.map((s) => s.name);

      log.warn(
        { configId, sopNames, stepCount: referencingSteps.length },
        "eval config deletion blocked — referenced by SOP steps",
      );

      throw Errors.evalConfigInUse(configId, referencingSteps.length, sopNames);
    }

    await tx.delete(evalConfigs).where(eq(evalConfigs.id, configId));
  });
}
