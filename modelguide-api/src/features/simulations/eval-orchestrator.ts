/**
 * Eval orchestrator — drives a test-case-driven simulation conversation.
 *
 * Separate from the existing orchestrator.ts which handles persona-driven
 * simulations with real tools. This orchestrator:
 * - Uses AgentAdapter (not direct OpenAI calls)
 * - Is driven by test case input (not persona system prompts)
 * - Supports optional persona follow-ups for multi-turn conversations
 * - Creates and completes simulation sessions
 *
 * The existing orchestrator and POST /api/simulations/run are unchanged.
 */

import { env } from "@/env";
import { addMessage, updateSession } from "@features/sessions/sessions.service";
import { getLogger } from "@lib/logger";
import type { AgentAdapter } from "./adapters/agent-adapter";
import { generatePersonaMessage } from "./llm-client";
import type { Persona } from "./personas";

const log = getLogger();

export interface EvalOrchestrationInput {
  /** Organization ID (RLS context). */
  orgId: string;
  /** Agent ID for session creation/message storage. */
  agentId: string;
  /** Pre-created simulation session ID. */
  sessionId: string;
  /** The agent adapter to communicate through. */
  adapter: AgentAdapter;
  /** The first message to send to the agent (from test case input). */
  inputMessage: string;
  /** Optional persona for generating follow-up messages after the agent responds. */
  persona?: Persona;
  /** Timeout in ms (defaults to SIMULATION_TIMEOUT_MS env var). */
  timeoutMs?: number;
  /** Max conversation turns (defaults to SIMULATION_MAX_TURNS env var). */
  maxTurns?: number;
}

export interface EvalOrchestrationResult {
  /** The simulation session ID (can be passed to eval scoring). */
  sessionId: string;
  /** Number of conversation turns completed. */
  turnCount: number;
  /** Final status. */
  status: "completed" | "max_turns_reached" | "timeout" | "error";
  /** Duration in milliseconds. */
  durationMs: number;
  /** Error message if status is "error". */
  error?: string;
}

/**
 * Run a test-case-driven simulation conversation.
 *
 * 1. Creates a simulation session with mock config in metadata
 * 2. Sends the test case's input message to the agent via adapter
 * 3. If persona is set and agent didn't end conversation, generates follow-ups
 * 4. Repeats until conversation ends, max turns reached, or timeout
 * 5. Completes the session
 */
export async function runEvalSimulation(
  input: EvalOrchestrationInput,
): Promise<EvalOrchestrationResult> {
  const { orgId, agentId, sessionId, adapter, inputMessage, persona } = input;

  const timeoutMs = input.timeoutMs ?? env.SIMULATION_TIMEOUT_MS;
  const maxTurns = input.maxTurns ?? env.SIMULATION_MAX_TURNS;
  const startTime = Date.now();

  let turnCount = 0;
  let status: EvalOrchestrationResult["status"] = "completed";
  let error: string | undefined;
  const conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];

  try {
    // First turn: send the test case input message
    let currentMessage = inputMessage;

    for (let turn = 0; turn < maxTurns; turn++) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        status = "timeout";
        break;
      }

      // Store user message
      await addMessage(orgId, sessionId, agentId, {
        role: "user",
        content: currentMessage,
        occurredAt: new Date(),
      });

      // Send to agent via adapter
      const agentResponse = await adapter.sendMessage(
        sessionId,
        currentMessage,
      );

      // Store agent response with tool calls
      if (agentResponse.toolCalls.length > 0) {
        await addMessage(orgId, sessionId, agentId, {
          role: "assistant",
          content: agentResponse.response || undefined,
          toolCalls: agentResponse.toolCalls.map((tc, i) => ({
            toolCallId: `tc_${turn}_${i}`,
            toolName: tc.name,
            toolInput: tc.arguments,
            toolOutput: (tc.result as Record<string, unknown>) ?? {},
            toolStatus: "success" as const,
          })),
          occurredAt: new Date(),
        });
      } else {
        await addMessage(orgId, sessionId, agentId, {
          role: "assistant",
          content: agentResponse.response,
          occurredAt: new Date(),
        });
      }

      // Track conversation history for persona context
      conversationHistory.push(
        { role: "user", content: currentMessage },
        { role: "assistant", content: agentResponse.response },
      );

      turnCount = turn + 1;

      // If agent signals conversation ended, stop
      if (agentResponse.conversationEnded) {
        status = "completed";
        break;
      }

      // If no persona, single-turn — we're done
      if (!persona) {
        status = "completed";
        break;
      }

      // Generate persona follow-up with full conversation history
      const personaResponse = await generatePersonaMessage(
        conversationHistory,
        persona.systemPrompt,
      );

      currentMessage = personaResponse.content;

      if (turn === maxTurns - 1) {
        status = "max_turns_reached";
      }
    }
  } catch (err) {
    status = "error";
    error = err instanceof Error ? err.message : "Unknown simulation error";
    log.error({ err, sessionId: sessionId, agentId }, "eval simulation failed");
  }

  // Complete the session
  const sessionStatus = status === "error" ? "abandoned" : "completed";
  try {
    await updateSession(orgId, sessionId, agentId, {
      status: sessionStatus,
    });
  } catch {
    // Session may already be ended
  }

  const durationMs = Date.now() - startTime;

  log.info(
    { sessionId: sessionId, turnCount, status, durationMs },
    "eval simulation completed",
  );

  return {
    sessionId: sessionId,
    turnCount,
    status,
    durationMs,
    ...(error && { error }),
  };
}
