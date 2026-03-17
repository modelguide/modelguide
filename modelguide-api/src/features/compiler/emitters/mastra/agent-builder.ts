/**
 * Mastra agent builder — creates an Agent instance from the IR.
 */

import { Agent } from "@mastra/core/agent";
import type { CompilerIR } from "../../core/types";

/**
 * Build a Mastra Agent from the CompilerIR.
 *
 * The agent's `instructions` are the fully assembled system prompt.
 * Tools are provided at invocation time via toolsets (MCP or direct).
 */
export function buildAgent(ir: CompilerIR): Agent {
  return new Agent({
    id: ir.agentConfig.id,
    name: ir.agentConfig.name,
    model: ir.agentConfig.model,
    instructions: ir.systemPrompt,
  });
}
