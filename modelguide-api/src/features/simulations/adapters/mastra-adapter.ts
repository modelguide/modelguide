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
  /** Max steps for agent.generate() tool-calling loops. */
  maxSteps?: number;
}

export class MastraAdapter implements AgentAdapter {
  private agent: Agent;
  private mcpClient: MCPClient;
  private config: MastraAdapterConfig;

  constructor(config: MastraAdapterConfig) {
    this.config = config;

    this.agent = new Agent({
      id: config.agentId,
      name: config.agentName,
      model: config.model,
      instructions: config.compiledInstructions,
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

    // Use the last step's text to avoid duplicated responses.
    // result.text concatenates text from ALL steps, so when the agent
    // produces text before AND after a tool call, it gets duplicated.
    const steps = result.steps ?? [];
    const lastStepText =
      steps.length > 0 ? (steps[steps.length - 1].text ?? "") : "";
    const responseText = lastStepText || result.text || "";

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
      // Mastra is single-response — each generate() call is one turn
      conversationEnded: true,
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
