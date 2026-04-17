/**
 * Simulation orchestrator — drives the conversation loop between
 * a persona (LLM-as-customer) and an agent (LLM with MCP tools).
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import { sessions } from "@db/schema";
import {
  executeTool,
  getAgentTools,
  resolveConnectorConfigById,
} from "@features/mcp/mcp.service";
import type { ResolvedTool } from "@features/mcp/mcp.types";
import {
  addMessage,
  createSession,
  updateSession,
} from "@features/sessions/sessions.service";
import { eq } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  generateAgentResponse,
  generatePersonaMessage,
  toOpenAiTools,
} from "./llm-client";
import { personaToIdentifier } from "./personas";
import type { Persona } from "./personas";
import {
  toPersonaLlmHistory,
  type SimulationHistoryMessage,
} from "./transcript";

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
  agentName: string;
  persona: Persona;
  maxTurns?: number;
}): Promise<SimulationResult> {
  const { orgId, agentId, persona } = params;
  const maxTurns =
    params.maxTurns ?? persona.maxTurns ?? env.SIMULATION_MAX_TURNS;
  const startTime = Date.now();

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

  // Create simulation session via session service
  const session = await createSession(orgId, agentId, {
    channelType: "api",
    userIdentifier: personaToIdentifier(persona.id),
    mode: "simulation",
    metadata: {
      personaId: persona.id,
      personaName: persona.name,
    },
  });

  const agentSystemPrompt = buildAgentSystemPrompt(
    params.agentName ?? "Agent",
    resolvedTools,
  );

  // Dialogue history tracked in the app's stored transcript semantics:
  // `user` = customer, `assistant` = agent. We project this into each model's
  // POV at the boundary rather than relying on inline role inversions.
  const dialogueHistory: SimulationHistoryMessage[] = [];
  const agentHistory: ChatCompletionMessageParam[] = [];

  let turnCount = 0;
  let status: SimulationResult["status"] = "completed";
  let error: string | undefined;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      // --- Persona turn ---
      // Convert the stored transcript into the customer's POV before asking
      // the persona model for the next reply.
      const personaLlmHistory = toPersonaLlmHistory(dialogueHistory);
      const personaResponse = await generatePersonaMessage(
        personaLlmHistory,
        persona.systemPrompt,
      );

      // Store user message
      await addMessage(orgId, session.id, agentId, {
        role: "user",
        content: personaResponse.content,
        occurredAt: new Date(),
      });

      dialogueHistory.push({ role: "user", content: personaResponse.content });
      agentHistory.push({ role: "user", content: personaResponse.content });

      // --- Agent turn ---
      const agentResponse = await generateAgentResponse(
        agentHistory,
        agentSystemPrompt,
        openAiTools,
      );

      // Handle tool calls
      if (agentResponse.toolCalls.length > 0) {
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

        // Execute all tools and collect results
        const executedToolCalls: Parameters<typeof addMessage>[3]["toolCalls"] =
          [];

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

          executedToolCalls!.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: toolCall.arguments,
            toolOutput: toolResult,
            toolStatus: "error" in toolResult ? "error" : "success",
          });

          agentHistory.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Store assistant + tool rows using the same path as real sessions
        await addMessage(orgId, session.id, agentId, {
          role: "assistant",
          content: agentResponse.content || undefined,
          toolCalls: executedToolCalls,
          occurredAt: new Date(),
        });

        // Get agent's follow-up response after tool results.
        // Pass no tools so the agent is forced to produce a text reply
        // rather than chaining into another tool call (which would yield null content).
        const followUp = await generateAgentResponse(
          agentHistory,
          agentSystemPrompt,
          [],
        );

        await addMessage(orgId, session.id, agentId, {
          role: "assistant",
          content: followUp.content,
          occurredAt: new Date(),
        });

        agentHistory.push({ role: "assistant", content: followUp.content });
        dialogueHistory.push({ role: "assistant", content: followUp.content });
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
        dialogueHistory.push({
          role: "assistant",
          content: agentResponse.content,
        });
      }

      turnCount = turn + 1;

      // Stop after the agent replies to a persona turn marked final.
      if (personaResponse.done) {
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

  // End the session — map simulation status to session status
  const sessionStatus = status === "error" ? "abandoned" : "completed";
  try {
    await updateSession(orgId, session.id, agentId, {
      status: sessionStatus,
    });
  } catch {
    // Session may already be ended if error occurred during addMessage
  }

  // Store simulation summary in session metadata
  await forOrg(orgId, async (tx) => {
    await tx
      .update(sessions)
      .set({
        metadata: {
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
