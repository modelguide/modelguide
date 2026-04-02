/**
 * Synthetic session service — stores AI agent generation results as
 * completed sessions for evaluation purposes.
 *
 * Extracts the same Mastra result → session_messages mapping that was
 * previously in the test helper, now available as a production service.
 */

import { addMessage, createSession, updateSession } from "./sessions.service";

// ============================================================================
// Types
// ============================================================================

/** Mastra generation step — loosely typed since Mastra's types are complex. */
interface GenerationStep {
  text?: string | null;
  toolCalls?: Array<{
    toolCallId?: string;
    toolName?: string;
    payload?: { toolName?: string };
    args?: Record<string, unknown>;
    result?: unknown;
  }>;
}

/** Mastra agent.generate() result subset. */
export interface GenerationResult {
  text?: string | null;
  steps: GenerationStep[];
}

export interface StoreSyntheticSessionOptions {
  orgId: string;
  agentId: string;
  generationResult: GenerationResult;
  userInput: string;
  channelType?: string;
  userIdentifier?: string;
}

// ============================================================================
// Service
// ============================================================================

/**
 * Store a Mastra agent generation result as a completed session with messages.
 *
 * 1. Creates a new session
 * 2. Stores the user input as a user message
 * 3. Iterates generation steps, storing assistant text + tool calls
 * 4. Marks the session as completed
 */
export async function storeSyntheticSession(
  opts: StoreSyntheticSessionOptions,
) {
  const {
    orgId,
    agentId,
    generationResult,
    userInput,
    channelType = "api",
    userIdentifier = "customer@modelguide.ai",
  } = opts;

  // 1. Create session
  const session = await createSession(orgId, agentId, {
    channelType,
    userIdentifier,
  });

  // 2. Store user input
  await addMessage(orgId, session.id, agentId, {
    role: "user",
    content: userInput,
  });

  // 3. Store generation steps
  for (const step of generationResult.steps) {
    const toolCalls =
      step.toolCalls?.map((tc) => ({
        toolCallId: tc.toolCallId ?? crypto.randomUUID(),
        toolName: tc.payload?.toolName ?? tc.toolName ?? "unknown",
        toolInput: tc.args ?? {},
        toolOutput:
          typeof tc.result === "object" && tc.result !== null
            ? (tc.result as Record<string, unknown>)
            : { result: tc.result },
        toolStatus: "success" as const,
      })) ?? [];

    if (step.text || toolCalls.length > 0) {
      await addMessage(orgId, session.id, agentId, {
        role: "assistant",
        content: step.text ?? undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }
  }

  // 4. Mark completed
  await updateSession(orgId, session.id, agentId, {
    status: "completed",
  });

  return session;
}
