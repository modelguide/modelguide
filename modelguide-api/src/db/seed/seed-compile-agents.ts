/**
 * Seed step: compile active SOPs for demo agents.
 *
 * Populates compiled_instructions, compiled_at, and compiled_from on agents
 * that have an active SOP assigned. This is required for the eval suite runner
 * which gates on compiled_instructions being non-null.
 *
 * Uses the real compiler pipeline so the seed prompt stays in sync with
 * production output.
 */

import { compile } from "@features/compiler/core/compile";
import type { CompilerInput } from "@features/compiler/core/types";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import {
  agentKnowledgeBase,
  agentSops,
  agents,
  connectorTools,
  connectors,
  knowledgeBase,
  sopSteps,
  sops,
} from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

export async function seedCompileAgents(db: SeedDb): Promise<void> {
  console.log("\n--- Compiling agents from assigned SOPs ---");

  // Find all agent→SOP assignments
  const assignments = await db
    .select({
      agentId: agentSops.agentId,
      sopId: agentSops.sopId,
    })
    .from(agentSops);

  if (assignments.length === 0) {
    console.log("  No agent→SOP assignments found, skipping compilation");
    return;
  }

  for (const { agentId, sopId } of assignments) {
    // Load agent
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));
    if (!agent) continue;

    // Load SOP (only compile active SOPs)
    const [sop] = await db.select().from(sops).where(eq(sops.id, sopId));
    if (!sop || sop.status !== "active") continue;

    // Load SOP steps
    const steps = await db
      .select()
      .from(sopSteps)
      .where(eq(sopSteps.sopId, sopId));

    if (steps.length === 0) continue;

    // Resolve connector tool names for steps
    const toolIds = steps
      .map((s) => s.connectorToolId)
      .filter((id): id is string => id !== null);

    const toolNameMap = new Map<
      string,
      { slug: string; connectorSlug: string }
    >();
    for (const toolId of toolIds) {
      const [tool] = await db
        .select({
          id: connectorTools.id,
          slug: connectorTools.slug,
          connectorSlug: connectors.slug,
        })
        .from(connectorTools)
        .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
        .where(eq(connectorTools.id, toolId));

      if (tool) {
        toolNameMap.set(toolId, {
          slug: tool.slug,
          connectorSlug: tool.connectorSlug,
        });
      }
    }

    // Load guardrails assigned to this agent
    const kbAssignments = await db
      .select({ knowledgeBaseId: agentKnowledgeBase.knowledgeBaseId })
      .from(agentKnowledgeBase)
      .where(eq(agentKnowledgeBase.agentId, agentId));

    const guardrailRows = [];
    for (const { knowledgeBaseId } of kbAssignments) {
      const [kb] = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, knowledgeBaseId));
      if (kb && kb.type === "guardrail" && kb.isActive) {
        guardrailRows.push(kb);
      }
    }

    // Build compiler input
    const trigger = ((sop.trigger as unknown) ?? {
      type: "intent_detected",
      config: { patterns: [] },
    }) as Record<string, unknown>;
    const metadata = (sop.metadata as Record<string, unknown>) ?? {
      tags: [],
    };

    const sopResponse = {
      id: sop.id,
      name: sop.name,
      slug: sop.slug,
      description: sop.description,
      status: sop.status as "active",
      version: sop.version,
      assignedAgents: [
        {
          id: agent.id,
          name: agent.name,
          modality: (agent.modality ?? "text") as "voice" | "text",
        },
      ],
      sopTemplateId: sop.sopTemplateId,
      template: null,
      definition: {
        schemaVersion: 1 as const,
        trigger,
        metadata,
        steps: steps.map((s) => {
          const toolInfo = s.connectorToolId
            ? toolNameMap.get(s.connectorToolId)
            : undefined;
          return {
            id: s.stepId,
            order: s.order,
            instruction: s.instruction,
            required: s.required,
            ...(s.notes ? { notes: s.notes } : {}),
            ...(s.evalConfigId ? { evalConfigId: s.evalConfigId } : {}),
            tool: toolInfo
              ? {
                  connectorToolId: s.connectorToolId!,
                  resolvedName: `${toolInfo.connectorSlug}_${toolInfo.slug}`,
                }
              : undefined,
          };
        }),
      },
      createdBy: sop.createdBy,
      createdAt: sop.createdAt.toISOString(),
      updatedAt: sop.updatedAt?.toISOString() ?? null,
    };

    const guardrailResponses = guardrailRows.map((g) => ({
      id: g.id,
      type: g.type as "guardrail",
      name: g.name,
      slug: g.slug,
      content: g.content,
      description: g.description,
      config: (g.config ?? {}) as Record<string, unknown>,
      isActive: g.isActive,
      assignedAgents: [],
      createdBy: g.createdBy,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt?.toISOString() ?? null,
    }));

    const compilerInput: CompilerInput = {
      sops: [sopResponse as CompilerInput["sops"][number]],
      guardrails: guardrailResponses,
      agentConfig: {
        id: agent.id,
        name: agent.name,
        model: "anthropic/claude-haiku-4-5-20251001",
        description: agent.description ?? "AI customer support agent",
        promptConfig: agent.promptConfig ?? {},
        modelFamily: agent.modelFamily ?? "generic",
        modality:
          agent.modality === "voice" ? ("voice" as const) : ("text" as const),
      },
    };

    try {
      const ir = compile(compilerInput);

      await db
        .update(agents)
        .set({
          compiledInstructions: ir.systemPrompt,
          compiledAt: new Date(),
          compiledFrom: {
            sopId: sop.id,
            sopName: sop.name,
            guardrailIds: guardrailRows.map((g) => g.id),
            toolCount: ir.tools.length,
            stepCount: ir.sop.steps.length,
          },
        })
        .where(eq(agents.id, agentId));

      console.log(
        `  Compiled ${agent.name} from SOP "${sop.name}" (${ir.systemPrompt.length} chars, ${ir.tools.length} tools)`,
      );
    } catch (err) {
      console.warn(
        `  Failed to compile ${agent.name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log("  Agent compilation seeded.");
}
