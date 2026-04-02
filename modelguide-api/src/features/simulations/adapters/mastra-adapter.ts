/**
 * Mastra agent adapter — connects the eval orchestrator to a compiled
 * Mastra agent using MCP toolsets from the simulation MCP route.
 *
 * The adapter creates a Mastra agent from compiled instructions,
 * connects it to mock tools via MCPClient pointing at the simulation
 * MCP URL, and calls agent.generate() for each message.
 *
 * Mastra is single-response per generate() call, so conversationEnded
 * is always true — the orchestrator handles multi-turn via persona.
 */

import { getLogger } from "@lib/logger";
import { Agent } from "@mastra/core/agent";
import { MCPClient } from "@mastra/mcp";
import type { AgentAdapter, AgentAdapterResponse } from "./agent-adapter";

const log = getLogger();

export interface MastraAdapterConfig {
  /** The compiled system prompt for the agent. */
  compiledInstructions: string;
  /** Agent model identifier (e.g., "anthropic/claude-haiku-4-5-20241022"). */
  model: string;
  /** Agent ID for Mastra agent construction. */
  agentId: string;
  /** Agent name for Mastra agent construction. */
  agentName: string;
  /** Full URL to the simulation MCP route (e.g., "http://localhost:3000/simulations/{id}/mcp"). */
  simulationMcpUrl: string;
  /** JWT for authenticating with the simulation MCP route. */
  simulationToken: string;
  /** Customer identifier (email/phone) — injected as runtime context, matching real agent behavior. */
  userIdentifier?: string;
  /** Max steps for agent.generate() tool-calling loops. */
  maxSteps?: number;
}

export class MastraAdapter implements AgentAdapter {
  private agent: Agent;
  private mcpClient: MCPClient;
  private config: MastraAdapterConfig;

  constructor(config: MastraAdapterConfig) {
    this.config = config;

    const instructions = config.userIdentifier
      ? `${config.compiledInstructions}\n\n## Runtime context\n\nCustomer identifier: ${config.userIdentifier}\nAlways use "${config.userIdentifier}" as the customer email when calling tools. You do not need to ask for their email.\n\nCRITICAL: You MUST execute every workflow step in order, starting from step 1. Do NOT skip steps even if the customer's request can be answered immediately.`
      : config.compiledInstructions;

    this.agent = new Agent({
      id: config.agentId,
      name: config.agentName,
      model: config.model,
      instructions,
    });

    this.mcpClient = new MCPClient({
      servers: {
        simulation: {
          url: new URL(config.simulationMcpUrl),
          requestInit: {
            headers: {
              Authorization: `Bearer ${config.simulationToken}`,
            },
          },
        },
      },
    });
  }

  async sendMessage(
    sessionId: string,
    message: string,
  ): Promise<AgentAdapterResponse> {
    log.debug(
      {
        agentId: this.config.agentId,
        sessionId,
        messageLength: message.length,
      },
      "MastraAdapter sending message",
    );

    const toolsets = await this.mcpClient.listToolsets();

    const result = await this.agent.generate(message, {
      toolsets,
      maxSteps: this.config.maxSteps ?? 5,
    });
    // Extract tool calls from the generation steps
    const toolCalls: AgentAdapterResponse["toolCalls"] = [];
    for (const step of result.steps ?? []) {
      for (const tc of step.toolCalls ?? []) {
        toolCalls.push({
          name: tc.payload.toolName,
          arguments: (tc.payload.args as Record<string, unknown>) ?? {},
          result: tc.payload.output,
        });
      }
    }

    // Extract the final response text, avoiding Mastra's concatenation.
    // result.text concatenates text from ALL steps, so when the agent
    // produces text before AND after a tool call, it gets duplicated.
    // We prefer the last step's text (the final agent utterance).
    const steps = result.steps ?? [];
    const responseText = extractResponseText(steps, result.text ?? "");

    log.debug(
      {
        agentId: this.config.agentId,
        sessionId,
        responseLength: responseText.length,
        toolCallCount: toolCalls.length,
        stepCount: steps.length,
      },
      "MastraAdapter received response",
    );

    return {
      response: responseText,
      toolCalls,
      // Mastra is single-response per generate() call, but the orchestrator
      // drives multi-turn via persona — never signal conversation ended.
      conversationEnded: false,
    };
  }

  /**
   * Disconnect the MCP client when done.
   * Call this after the simulation completes to clean up resources.
   */
  async disconnect(): Promise<void> {
    try {
      await this.mcpClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}

/**
 * Extract the agent's final response text from generation steps.
 *
 * Mastra's `result.text` concatenates text from ALL steps, causing
 * duplication when the agent produces text in multiple steps (e.g.,
 * before and after a tool call). We prefer the last step that has text,
 * falling back to the full concatenated text if no steps are available.
 */
function extractResponseText(
  steps: Array<{ text?: string | null }>,
  fullText: string,
): string {
  for (let i = steps.length - 1; i >= 0; i--) {
    const text = steps[i].text?.trim();
    if (text) return text;
  }
  return fullText.trim();
}
