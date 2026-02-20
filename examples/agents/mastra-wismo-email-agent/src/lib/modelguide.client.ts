/**
 * ModelGuide session management helpers.
 *
 * Architecture: real-time streaming via onStepFinish.
 * - Session is pre-created before agent.generate() (MCP tools require an active session).
 * - Each step's messages are posted immediately inside onStepFinish — crash-resilient.
 * - After generate(), PATCH sets the final status.
 * - The post-call batch webhook is no longer used.
 */

import { apiBaseUrl, config } from "../config.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types re-exported from @mastra/core for use in webhook.ts
// ---------------------------------------------------------------------------

import type { ToolCallChunk, ToolResultChunk } from "@mastra/core/stream";

// A step from FullOutput.steps — also matches onStepFinish callback argument shape
export interface Step {
  text: string;
  toolCalls?: ToolCallChunk[];
  toolResults?: ToolResultChunk[];
  response?: { timestamp?: Date };
}

export interface ToolCallData {
  toolCallId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  latencyMs?: number;
}

export interface MessageData {
  role: "user" | "assistant";
  content?: string;
  occurredAt?: string;
  toolCalls?: ToolCallData[];
}

export interface EmailContext {
  from: string;
  to: string[];
  subject: string;
  body: string;
  receivedAt?: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function logAgentTurns(steps: Step[], stepLatenciesMs?: number[]): void {
  for (const [i, step] of steps.entries()) {
    const latencyMs = stepLatenciesMs?.[i];
    if (step.text) {
      logger.info({ step: i, text: step.text }, "Agent turn: reasoning");
    }
    for (const tc of step.toolCalls ?? []) {
      const tr = (step.toolResults ?? []).find(
        (r: ToolResultChunk) => r.payload.toolCallId === tc.payload.toolCallId,
      );
      logger.info(
        {
          step: i,
          latencyMs,
          tool: tc.payload.toolName,
          input: tc.payload.args,
          output: tr?.payload.result ?? null,
          isError: tr?.payload.isError ?? false,
        },
        "Agent turn: tool call",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Message extraction helpers
// ---------------------------------------------------------------------------

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

/**
 * Build the formatted user message from email metadata.
 * Stored as the first message in the session.
 */
export function buildEmailUserMessage(email: EmailContext): MessageData {
  // Normalize receivedAt to ISO 8601 — Resend's created_at may not be in that format.
  let occurredAt: string | undefined;
  if (email.receivedAt) {
    const d = new Date(email.receivedAt);
    occurredAt = isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return {
    role: "user",
    content: [
      `From: ${email.from}`,
      `To: ${email.to.join(", ")}`,
      `Subject: ${email.subject}`,
      ``,
      email.body,
    ].join("\n"),
    occurredAt,
  };
}

/**
 * Extract MessageData[] from a single agent step.
 * Returns 0, 1, or 2 messages (text and/or tool calls — split for transparency).
 */
export function extractStepMessages(
  step: Step,
  occurredAt?: string,
  stepLatencyMs?: number,
): MessageData[] {
  const msgs: MessageData[] = [];
  const stepToolCalls = step.toolCalls ?? [];

  const toolCalls: ToolCallData[] = [];
  const perToolLatencyMs =
    stepLatencyMs && stepToolCalls.length
      ? Math.round(stepLatencyMs / stepToolCalls.length)
      : undefined;

  for (const tc of stepToolCalls) {
    const tr = (step.toolResults ?? []).find(
      (r: ToolResultChunk) => r.payload.toolCallId === tc.payload.toolCallId,
    );
    toolCalls.push({
      toolCallId: tc.payload.toolCallId,
      toolName: tc.payload.toolName,
      toolInput: (tc.payload.args as Record<string, unknown> | undefined) ?? undefined,
      toolOutput: tr ? toRecord(tr.payload.result) : undefined,
      latencyMs: perToolLatencyMs,
    });
  }

  if (step.text) {
    msgs.push({ role: "assistant", content: step.text, occurredAt });
  }
  if (toolCalls.length > 0) {
    // Offset tool calls by 1ms so they always sort after the reasoning text
    // when both share the same occurredAt — avoids relying on insertion order.
    const toolOccurredAt = occurredAt
      ? new Date(new Date(occurredAt).getTime() + 1).toISOString()
      : undefined;
    msgs.push({ role: "assistant", toolCalls, occurredAt: toolOccurredAt });
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${config.MCP_API_KEY}`,
};

/**
 * Pre-create a ModelGuide session before running the agent.
 * MCP tools call validateActiveSession() on every invocation, so a real DB session
 * must exist before any MCP tool call can succeed.
 */
export async function createSession(params: {
  senderEmail: string;
  externalId: string;
}): Promise<string> {
  const res = await fetch(`${apiBaseUrl}/api/sessions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      channelType: "email",
      userIdentifier: params.senderEmail,
      externalId: params.externalId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info({ sessionId: data.id, senderEmail: params.senderEmail }, "Session created");
  return data.id;
}

/**
 * POST a single message to an existing session.
 * Errors are logged but never thrown.
 */
async function postMessage(sessionId: string, message: MessageData): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ sessionId, status: res.status, body: text }, "Failed to post message");
  }
}

/**
 * PATCH session status to a terminal state.
 * Errors are logged but never thrown.
 */
export async function patchSessionStatus(
  sessionId: string,
  status: "completed" | "abandoned",
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ sessionId, status, body: text }, "Failed to patch session status");
  } else {
    logger.info({ sessionId, status }, "Session closed");
  }
}

/**
 * Post all messages for one agent step immediately.
 * Called from onStepFinish — each step is persisted as it completes.
 * occurredAt is taken from step.response.timestamp (Anthropic API value).
 */
export async function postStepMessages(
  sessionId: string,
  step: Step,
  stepLatencyMs: number,
): Promise<void> {
  const occurredAt = (step.response?.timestamp ?? new Date()).toISOString();
  const messages = extractStepMessages(step, occurredAt, stepLatencyMs);
  await Promise.all(messages.map((msg) => postMessage(sessionId, msg)));
}

/**
 * Post the formatted user email message to the session.
 * Called before agent.generate() so the inbound email is always stored,
 * even if the agent crashes mid-run.
 */
export async function postUserMessage(
  sessionId: string,
  email: EmailContext,
): Promise<void> {
  await postMessage(sessionId, buildEmailUserMessage(email));
}
