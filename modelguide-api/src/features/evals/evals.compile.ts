/**
 * Eval compilation layer.
 *
 * Resolves eval configs and connector tool IDs into a ready-to-execute eval plan.
 * This is where eval_config_id references are looked up and connector tool IDs
 * are resolved to runtime tool names ({connectorSlug}_{toolSlug}).
 */

import { forOrg } from "@db/rls";
import {
  connectorTools,
  connectors,
  evalConfigs,
  sopSteps,
  sops,
} from "@db/schema";
import { Errors } from "@lib/errors";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { EvalPlan, EvalPlanStep, ResolvedEvaluator } from "./evals.types";

// ============================================================================
// Tool ID resolution
// ============================================================================

/**
 * Extract connector tool IDs from an eval config's JSONB config.
 */
export function extractConnectorToolIds(
  config: Record<string, unknown>,
): string[] {
  const ids: string[] = [];
  if (
    typeof config.connectorToolId === "string" &&
    config.connectorToolId.length > 0
  ) {
    ids.push(config.connectorToolId);
  }
  return ids;
}

// ============================================================================
// Compilation
// ============================================================================

/**
 * Compile a SOP into an eval plan ready for execution.
 *
 * 1. Loads the SOP and its steps
 * 2. For each step with an eval_config_id, loads the eval config
 * 3. Resolves connector tool IDs to runtime tool names
 */
export async function compileSopToEvalPlan(
  orgId: string,
  sopId: string,
  sessionId: string,
): Promise<EvalPlan> {
  return forOrg(orgId, async (tx) => {
    // 1. Load the SOP
    const [sop] = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.id, sopId));

    if (!sop) {
      throw Errors.sopNotFound(sopId);
    }

    // 2. Load steps with tool resolution data
    const stepRows = await tx
      .select({
        stepId: sopSteps.stepId,
        order: sopSteps.order,
        instruction: sopSteps.instruction,
        required: sopSteps.required,
        evalConfigId: sopSteps.evalConfigId,
      })
      .from(sopSteps)
      .where(eq(sopSteps.sopId, sopId))
      .orderBy(asc(sopSteps.order));

    // 3. Batch-load all referenced eval configs
    const evalConfigIds = [
      ...new Set(
        stepRows
          .map((s) => s.evalConfigId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const evalConfigRows =
      evalConfigIds.length > 0
        ? await tx
            .select()
            .from(evalConfigs)
            .where(inArray(evalConfigs.id, evalConfigIds))
        : [];

    const evalConfigMap = new Map(evalConfigRows.map((c) => [c.id, c]));

    // 4. Batch-load all connector tool IDs that need resolution
    const allConnectorToolIds: string[] = [];
    for (const cfg of evalConfigRows) {
      const ids = extractConnectorToolIds(
        cfg.config as Record<string, unknown>,
      );
      allConnectorToolIds.push(...ids);
    }
    const uniqueToolIds = [...new Set(allConnectorToolIds)];

    // Resolve all tool IDs at once: connector_tools → connectors → {slug}_{slug}
    const toolNameMap = new Map<string, string>();
    if (uniqueToolIds.length > 0) {
      const toolRows = await tx
        .select({
          toolId: connectorTools.id,
          toolSlug: connectorTools.slug,
          connectorSlug: connectors.slug,
        })
        .from(connectorTools)
        .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
        .where(
          and(
            inArray(connectorTools.id, uniqueToolIds),
            isNull(connectorTools.deletedAt),
          ),
        );

      for (const row of toolRows) {
        toolNameMap.set(row.toolId, `${row.connectorSlug}_${row.toolSlug}`);
      }
    }

    // 5. Build plan steps
    const steps: EvalPlanStep[] = stepRows.map((row) => {
      if (!row.evalConfigId) {
        return {
          stepId: row.stepId,
          order: row.order,
          instruction: row.instruction,
          required: row.required,
          evaluator: null,
          toolNameMap: {},
        };
      }

      const cfg = evalConfigMap.get(row.evalConfigId);
      if (!cfg) {
        return {
          stepId: row.stepId,
          order: row.order,
          instruction: row.instruction,
          required: row.required,
          evaluator: null,
          toolNameMap: {},
        };
      }

      const evaluator: ResolvedEvaluator = {
        configId: cfg.id,
        evaluatorType: cfg.evaluatorType as ResolvedEvaluator["evaluatorType"],
        config: cfg.config as Record<string, unknown>,
      };

      // Build per-step tool name map from the eval config's connector tool IDs
      const stepToolNameMap: Record<string, string> = {};
      const configToolIds = extractConnectorToolIds(
        cfg.config as Record<string, unknown>,
      );
      for (const toolId of configToolIds) {
        const resolved = toolNameMap.get(toolId);
        if (resolved) {
          stepToolNameMap[toolId] = resolved;
        } else {
          // Unresolved — evaluator handles gracefully
          stepToolNameMap[toolId] = toolId;
        }
      }

      return {
        stepId: row.stepId,
        order: row.order,
        instruction: row.instruction,
        required: row.required,
        evaluator,
        toolNameMap: stepToolNameMap,
      };
    });

    return { sessionId, sopId, steps };
  });
}
