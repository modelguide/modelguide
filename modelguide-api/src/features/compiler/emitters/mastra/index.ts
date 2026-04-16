/**
 * Mastra emitter — transforms CompilerIR into Mastra runtime objects.
 *
 * Returns { agent, workflows, tools } ready for registration with
 * a Mastra instance.
 */

import type { Agent } from "@mastra/core/agent";
import type { CompilerIR } from "../../core/types";
import { buildAgent } from "./agent-builder";
import { buildTools } from "./tool-builder";
import { buildWorkflows } from "./workflow-builder";

export interface MastraEmitterResult {
  /** Mastra Agent with systemPrompt as instructions. */
  agent: Agent;
  /** Workflows keyed by SOP slug. */
  // biome-ignore lint/suspicious/noExplicitAny: Mastra workflow types are complex
  workflows: Record<string, any>;
  /** Stub tools keyed by resolvedName. Replace with real implementations. */
  // biome-ignore lint/suspicious/noExplicitAny: Mastra tool types are complex
  tools: Record<string, any>;
}

/**
 * Convert a CompilerIR into Mastra runtime objects.
 *
 * - agent: Mastra Agent with systemPrompt as instructions
 * - workflows: Record keyed by SOP slug
 * - tools: Record keyed by resolvedName (stubs — replace with real implementations)
 */
export function toMastra(ir: CompilerIR): MastraEmitterResult {
  const agent = buildAgent(ir);

  // Build workflows for each SOP
  let workflows: Record<string, unknown> = {};
  for (const sop of ir.sops) {
    const sopWorkflows = buildWorkflows(sop.slug, sop.steps, ir.agentConfig.id);
    workflows = { ...workflows, ...sopWorkflows };
  }

  const tools = buildTools(ir.tools);

  return { agent, workflows, tools };
}
