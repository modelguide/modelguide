/**
 * Simulation orchestrator — drives the conversation loop between
 * a persona (LLM-as-customer) and an agent (LLM with MCP tools).
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import { sessions } from "@db/schema";
import { getAgentById } from "@features/agents/agents.service";
import {
  executeTool,
  getAgentTools,
  resolveConnectorConfigById,
} from "@features/mcp/mcp.service";
import type { ResolvedTool } from "@features/mcp/mcp.types";
import { addMessage, updateSession } from "@features/sessions/sessions.service";
import { Errors } from "@lib/errors";
import { eq } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  generateAgentResponse,
  generatePersonaMessage,
  toOpenAiTools,
} from "./llm-client";
import type { Persona } from "./personas";

export interface SimulationResult {
  sessionId: string;
  personaId: string;
  turnCount: number;
  status: "completed" | "max_turns_reached" | "error";
  durationMs: number;
  error?: string;
}

/**
 * Run a full simulation: persona ↔ agent conversation loop.
 */
export async function runSimulation(params: {
  orgId: string;
  agentId: string;
  persona: Persona;
  maxTurns?: number;
}): Promise<SimulationResult> {
  const { orgId, agentId, persona } = params;
  const maxTurns =
    params.maxTurns ?? persona.maxTurns ?? env.SIMULATION_MAX_TURNS;
  const startTime = Date.now();

  // Validate agent
  const agent = await getAgentById(orgId, agentId);
  if (!agent.isActive) {
    throw Errors.agentInactive(agentId);
  }

  // Resolve agent tools
  const resolvedTools = await getAgentTools(orgId, agentId);
  const openAiTools = toOpenAiTools(resolvedTools);

  // Build tool lookup for execution
  const toolLookup = new Map<string, ResolvedTool>();
  for (const t of resolvedTools) {
    toolLookup.set(t.mcpName, t);
  }

  // Pre-resolve connector configs for tool execution
  const configCache = new Map<string, Record<string, string>>();
  for (const t of resolvedTools) {
    if (!configCache.has(t.connectorId)) {
      const config = await resolveConnectorConfigById(orgId, t.connectorId);
      configCache.set(t.connectorId, config);
    }
  }

  // Create simulation session
  const session = await forOrg(orgId, async (tx) => {
    const [s] = await tx
      .insert(sessions)
      .values({
        organizationId: orgId,
        agentId,
        channelType: "api",
        userIdentifier: `simulation:${persona.id}`,
        mode: "simulation",
        status: "active",
        startedAt: new Date(),
        metadata: {
          simulation: true,
          personaId: persona.id,
          personaName: persona.name,
        },
      })
      .returning();
    return s;
  });

  const agentSystemPrompt = buildAgentSystemPrompt(agent.name, resolvedTools);

  // Conversation history for the LLM (not stored in DB — DB messages are the source of truth)
  const personaHistory: ChatCompletionMessageParam[] = [];
  const agentHistory: ChatCompletionMessageParam[] = [];

  let turnCount = 0;
  let status: SimulationResult["status"] = "completed";
  let error: string | undefined;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      // --- Persona turn ---
      const personaResponse = await generatePersonaMessage(
        personaHistory,
        persona.systemPrompt,
      );

      // Store user message
      await addMessage(orgId, session.id, agentId, {
        role: "user",
        content: personaResponse.content,
        occurredAt: new Date(),
      });

      personaHistory.push({ role: "user", content: personaResponse.content });
      agentHistory.push({ role: "user", content: personaResponse.content });

      // --- Agent turn ---
      const agentResponse = await generateAgentResponse(
        agentHistory,
        agentSystemPrompt,
        openAiTools,
      );

      // Handle tool calls
      if (agentResponse.toolCalls.length > 0) {
        // Store assistant message with tool calls placeholder
        agentHistory.push({
          role: "assistant",
          content: agentResponse.content || null,
          tool_calls: agentResponse.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });

        for (const toolCall of agentResponse.toolCalls) {
          const tool = toolLookup.get(toolCall.name);
          if (!tool) continue;

          const config = configCache.get(tool.connectorId) ?? {};
          let toolResult: Record<string, unknown>;

          try {
            const result = await executeTool(
              orgId,
              tool.connectorId,
              tool.catalogSlug,
              tool.catalogToolName,
              config,
              toolCall.arguments,
            );
            toolResult = result as unknown as Record<string, unknown>;
          } catch (err) {
            toolResult = {
              error:
                err instanceof Error ? err.message : "Tool execution failed",
            };
          }

          // Store tool call in session messages
          await addMessage(orgId, session.id, agentId, {
            role: "tool",
            content: JSON.stringify(toolResult),
            occurredAt: new Date(),
            toolCalls: [
              {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolInput: toolCall.arguments,
                toolOutput: toolResult,
                toolStatus: "error" in toolResult ? "error" : "success",
              },
            ],
          });

          agentHistory.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Get agent's follow-up response after tool results
        const followUp = await generateAgentResponse(
          agentHistory,
          agentSystemPrompt,
          openAiTools,
        );

        await addMessage(orgId, session.id, agentId, {
          role: "assistant",
          content: followUp.content,
          occurredAt: new Date(),
        });

        agentHistory.push({ role: "assistant", content: followUp.content });
        personaHistory.push({
          role: "assistant",
          content: followUp.content,
        });
      } else {
        // No tool calls — store the agent's text response directly
        await addMessage(orgId, session.id, agentId, {
          role: "assistant",
          content: agentResponse.content,
          occurredAt: new Date(),
        });

        agentHistory.push({
          role: "assistant",
          content: agentResponse.content,
        });
        personaHistory.push({
          role: "assistant",
          content: agentResponse.content,
        });
      }

      turnCount = turn + 1;

      // Check stop condition — persona signals end of conversation
      if (isConversationEnding(personaResponse.content)) {
        status = "completed";
        break;
      }

      if (turn === maxTurns - 1) {
        status = "max_turns_reached";
      }
    }
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : "Unknown simulation error";
  }

  // End the session
  try {
    await updateSession(orgId, session.id, agentId, { status: "completed" });
  } catch {
    // Session may already be ended if error occurred during addMessage
  }

  // Store simulation summary in session metadata
  await forOrg(orgId, async (tx) => {
    await tx
      .update(sessions)
      .set({
        metadata: {
          simulation: true,
          personaId: persona.id,
          personaName: persona.name,
          turnCount,
          status,
          durationMs: Date.now() - startTime,
          ...(error && { error }),
        },
      })
      .where(eq(sessions.id, session.id));
  });

  return {
    sessionId: session.id,
    personaId: persona.id,
    turnCount,
    status,
    durationMs: Date.now() - startTime,
    ...(error && { error }),
  };
}

function buildAgentSystemPrompt(
  agentName: string,
  tools: ResolvedTool[],
): string {
  const toolList = tools.map((t) => `- ${t.mcpName}: ${t.description}`);
  return `You are "${agentName}", a customer support agent. Help the customer with their request using the tools available to you.

Available tools:
${toolList.join("\n")}

Guidelines:
- Be helpful and professional
- Use tools when needed to look up information or perform actions
- Provide clear, concise responses
- If you can't help with something, explain why`;
}

/**
 * Simple heuristic to detect if the persona is ending the conversation.
 */
function isConversationEnding(content: string): boolean {
  const lower = content.toLowerCase();
  const endings = [
    "goodbye",
    "bye",
    "that's all",
    "thanks, that's all",
    "thank you, goodbye",
    "i'll think about it",
    "have a good day",
    "nothing else",
    "that's everything",
  ];
  return endings.some((e) => lower.includes(e));
}
