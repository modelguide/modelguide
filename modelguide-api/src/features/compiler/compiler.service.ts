/**
 * Compiler service — compiles an agent from a SOP + guardrails and persists
 * the compiled instructions to the agents table.
 */

import { forOrg } from "@db/rls";
import {
  agentConnectorTools,
  agentKnowledgeBase,
  agents,
  connectorTools,
  connectors,
  knowledgeBase,
} from "@db/schema";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import { and, eq } from "drizzle-orm";

import { resolveAgentSops } from "@features/mcp/mcp.service";
import { getSopById } from "@features/sops/sops.service";
import { compile } from "./core/compile";
import type {
  Channel,
  CompilerInput,
  KnowledgeBaseDetailResponse,
  ModelFamily,
} from "./core/types";

const log = getLogger();

// ============================================================================
// Types
// ============================================================================

interface CompileAgentInput {
  orgId: string;
  agentId: string;
  sopId: string;
  agentModel?: string;
  agentDescription?: string;
  dryRun?: boolean;
}

// ============================================================================
// Service
// ============================================================================

/**
 * Compile an agent from a SOP + guardrails.
 *
 * 1. Loads the SOP detail (with steps and resolved tool names)
 * 2. Loads active guardrails assigned to the agent
 * 3. Runs the compiler pipeline
 * 4. Persists compiled_instructions, compiled_at, compiled_from
 */
export async function compileAgent(input: CompileAgentInput) {
  const { orgId, agentId, sopId, agentModel, agentDescription, dryRun } = input;

  // 1. Load agent
  const agent = await forOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        modality: agents.modality,
        modelFamily: agents.modelFamily,
        promptConfig: agents.promptConfig,
      })
      .from(agents)
      .where(eq(agents.id, agentId));

    if (!row) {
      throw Errors.agentNotFound(agentId);
    }
    return row;
  });

  // 2. Load SOP detail
  const sopDetail = await getSopById(orgId, sopId);

  // 3. Load active guardrails assigned to the agent
  const guardrails = await forOrg(orgId, async (tx) => {
    const assignedIds = await tx
      .select({ knowledgeBaseId: agentKnowledgeBase.knowledgeBaseId })
      .from(agentKnowledgeBase)
      .where(eq(agentKnowledgeBase.agentId, agentId));

    if (assignedIds.length === 0) return [];

    const rows = await tx
      .select()
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.isActive, true),
          eq(knowledgeBase.type, "guardrail"),
        ),
      );

    // Filter to only assigned ones
    const assignedSet = new Set(assignedIds.map((r) => r.knowledgeBaseId));
    return rows.filter((r) => assignedSet.has(r.id));
  });

  // Convert DB rows to KnowledgeBaseDetailResponse shape
  const guardrailResponses: KnowledgeBaseDetailResponse[] = guardrails.map(
    (g) => ({
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
    }),
  );

  // 4. Load tool confirmation settings from agent_connector_tools (AC6)
  const toolConfirmationMap: Record<string, boolean> = {};
  const agentToolSettings = await forOrg(orgId, async (tx) => {
    return tx
      .select({
        slug: connectorTools.slug,
        connectorSlug: connectors.slug,
        requiresConfirmation: agentConnectorTools.requiresConfirmation,
      })
      .from(agentConnectorTools)
      .innerJoin(
        connectorTools,
        eq(agentConnectorTools.connectorToolId, connectorTools.id),
      )
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .where(eq(agentConnectorTools.agentId, agentId));
  });

  for (const row of agentToolSettings) {
    const resolvedName = `${row.connectorSlug}_${row.slug}`;
    toolConfirmationMap[resolvedName] = row.requiresConfirmation;
  }

  // 5. Load all active SOPs assigned to the agent (for intent classification)
  const agentSopRows = await resolveAgentSops(orgId, agentId);

  // 6. Convert SOP DB result to SopDetailResponse shape
  const sopResponse = {
    id: sopDetail.id,
    name: sopDetail.name,
    slug: sopDetail.slug,
    description: sopDetail.description,
    status: sopDetail.status as "draft" | "active" | "archived",
    version: sopDetail.version,
    assignedAgents: sopDetail.assignedAgents.map((a) => ({
      id: a.id,
      name: a.name,
      modality: a.modality as "voice" | "text",
    })),
    sopTemplateId: sopDetail.sopTemplateId,
    template: sopDetail.template,
    definition: sopDetail.definition,
    createdBy: sopDetail.createdBy,
    createdAt: sopDetail.createdAt.toISOString(),
    updatedAt: sopDetail.updatedAt?.toISOString() ?? null,
  };

  // 7. Derive channel from modality (AC4)
  const channel: Channel = agent.modality === "voice" ? "voice" : "text";

  // 8. Run compiler
  const compilerInput: CompilerInput = {
    sops: [sopResponse],
    guardrails: guardrailResponses,
    agentConfig: {
      id: agent.id,
      name: agent.name,
      model: agentModel ?? "anthropic/claude-haiku-4-5-20251001",
      description:
        agentDescription ?? agent.description ?? "AI customer support agent",
      promptConfig: agent.promptConfig ?? {},
      modelFamily: agent.modelFamily as ModelFamily,
      channel,
    },
    agentSops: agentSopRows,
    toolConfirmationMap,
  };

  const ir = compile(compilerInput);

  // 9. Build provenance metadata
  const compiledFrom = {
    sopId,
    sopName: sopDetail.name,
    guardrailIds: guardrails.map((g) => g.id),
    toolCount: ir.tools.length,
    stepCount: ir.sop.steps.length,
  };

  // 10. Dry-run: return result without persisting
  if (dryRun) {
    log.info(
      {
        agentId,
        sopId,
        promptLength: ir.systemPrompt.length,
        toolCount: ir.tools.length,
        guardrailCount: guardrails.length,
        dryRun: true,
      },
      "agent compiled (dry run)",
    );

    return {
      agent: null,
      compiledFrom,
      ir,
    };
  }

  // 11. Persist compiled instructions
  const updatedAgent = await forOrg(orgId, async (tx) => {
    const [row] = await tx
      .update(agents)
      .set({
        compiledInstructions: ir.systemPrompt,
        compiledAt: new Date(),
        compiledFrom,
      })
      .where(eq(agents.id, agentId))
      .returning();
    return row;
  });

  log.info(
    {
      agentId,
      sopId,
      promptLength: ir.systemPrompt.length,
      toolCount: ir.tools.length,
      guardrailCount: guardrails.length,
    },
    "agent compiled successfully",
  );

  return {
    agent: updatedAgent,
    compiledFrom,
    ir,
  };
}
