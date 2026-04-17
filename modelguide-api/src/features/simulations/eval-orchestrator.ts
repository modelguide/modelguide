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
  /**
   * Optional prior conversation turns for replay tests.
   * When provided, these are stored in the session as context messages
   * and passed to the adapter so the model sees full conversational history.
   */
  conversationHistory?: Array<{ role: string; content: string }>;
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
 * The entire conversation loop runs under a single timeout via Promise.race.
 * This catches hangs in adapter.sendMessage(), persona generation, and
 * message storage — not just between turns.
 */
export async function runEvalSimulation(
  input: EvalOrchestrationInput,
): Promise<EvalOrchestrationResult> {
  const { orgId, agentId, sessionId } = input;
  const timeoutMs = input.timeoutMs ?? env.SIMULATION_TIMEOUT_MS;
  const startTime = Date.now();

  let result: EvalOrchestrationResult;

  try {
    result = await Promise.race([
      runConversationLoop(input, startTime),
      rejectAfterTimeout(timeoutMs),
    ]);
  } catch (err) {
    const isTimeout =
      err instanceof Error && err.message === "Simulation timeout";
    result = {
      sessionId,
      turnCount: 0,
      status: isTimeout ? "timeout" : "error",
      durationMs: Date.now() - startTime,
      ...(!isTimeout && {
        error: err instanceof Error ? err.message : "Unknown simulation error",
      }),
    };
    if (!isTimeout) {
      log.error({ err, sessionId, agentId }, "eval simulation failed");
    }
  }

  // Complete the session
  const sessionStatus = result.status === "error" ? "abandoned" : "completed";
  try {
    await updateSession(orgId, sessionId, agentId, {
      status: sessionStatus,
    });
  } catch {
    // Session may already be ended
  }

  log.info(
    {
      sessionId,
      turnCount: result.turnCount,
      status: result.status,
      durationMs: result.durationMs,
    },
    "eval simulation completed",
  );

  return result;
}

// ============================================================================
// Internal
// ============================================================================

async function runConversationLoop(
  input: EvalOrchestrationInput,
  startTime: number,
): Promise<EvalOrchestrationResult> {
  const {
    orgId,
    agentId,
    sessionId,
    adapter,
    inputMessage,
    persona,
    conversationHistory: priorHistory,
  } = input;
  const maxTurns = input.maxTurns ?? env.SIMULATION_MAX_TURNS;

  // Store prior conversation history in the session so evaluators
  // (especially llm_judge) see the full transcript when scoring.
  if (priorHistory && priorHistory.length > 0) {
    for (const msg of priorHistory) {
      await addMessage(orgId, sessionId, agentId, {
        role: msg.role as "user" | "assistant",
        content: msg.content,
        occurredAt: new Date(),
      });
    }
  }

  let currentMessage = inputMessage;
  let turnCount = 0;
  const conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    // Store user message
    await addMessage(orgId, sessionId, agentId, {
      role: "user",
      content: currentMessage,
      occurredAt: new Date(),
    });

    // Send to agent via adapter — pass the full running conversation each turn
    // (priorHistory from replay yaml + everything we've accumulated so far).
    // Mastra's Agent.generate() is stateless without memory config, so without
    // this the agent has amnesia on turn 1+ and re-asks questions it already
    // asked (re-verifies identity, etc.).
    const historyForAdapter = [...(priorHistory ?? []), ...conversationHistory];
    const agentResponse = await adapter.sendMessage(
      sessionId,
      currentMessage,
      historyForAdapter.length > 0 ? historyForAdapter : undefined,
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
      return {
        sessionId,
        turnCount,
        status: "completed",
        durationMs: Date.now() - startTime,
      };
    }

    // If no persona, single-turn — we're done
    if (!persona) {
      return {
        sessionId,
        turnCount,
        status: "completed",
        durationMs: Date.now() - startTime,
      };
    }

    // Generate persona follow-up with full conversation history.
    // Role flip: from the persona LLM's POV it IS the customer, so the
    // customer's prior turns are its own ("assistant") and the agent's
    // turns are incoming ("user"). Without this flip the persona reads
    // the agent's messages as its own past outputs and echoes them back.
    const personaHistory = [
      ...(priorHistory ?? []),
      ...conversationHistory,
    ].map((msg) => ({
      role: msg.role === "user" ? ("assistant" as const) : ("user" as const),
      content: msg.content,
    }));
    const personaResponse = await generatePersonaMessage(
      personaHistory,
      persona.systemPrompt,
    );

    currentMessage = personaResponse.content;
  }

  return {
    sessionId,
    turnCount,
    status: "max_turns_reached",
    durationMs: Date.now() - startTime,
  };
}

function rejectAfterTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Simulation timeout")), ms);
  });
}
