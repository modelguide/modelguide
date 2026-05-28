/**
 * Mode B glue: a HOC that wraps a tool handler with non-blocking signal
 * emission and a registry that connects a HubSpot connector instance to
 * its `SignalEmissionQueue`.
 *
 * Tool handlers stay focused on the HubSpot call. After the inner handler
 * returns success, `withSignalEmission` builds the envelope and enqueues
 * it. The response to the agent never waits on emission.
 *
 * Per-connector queue lookup: each HubSpot connector instance gets its
 * own queue (separate KS / vault / Mode B toggle). The registry below
 * caches by `connectorId` so a single connector reuses the same queue
 * across tool invocations.
 */

import { getLogger } from "@lib/logger";
import { createLoreVaultClient } from "../../../../../lorevault/binding";
import { SignalEmissionQueue } from "../../../../../lorevault/emission";
import type { ToolExecutionContext, ToolExecutionResult } from "../../../types";
import {
  type EmissionConfig,
  type EmittingToolName,
  buildEnvelopeForTool,
} from "./envelopes";

// ---------------------------------------------------------------------------
// Per-connector queue registry
// ---------------------------------------------------------------------------

interface QueueEntry {
  queue: SignalEmissionQueue;
  started: Promise<{ allowed: boolean }>;
}

const queues = new Map<string, QueueEntry>();

/**
 * Replace the queue factory for tests. Returning `null` disables Mode B
 * for the test (handlers behave as if `signalEmissionEnabled = false`).
 */
let queueFactory: (ctx: ToolExecutionContext) => SignalEmissionQueue | null =
  defaultQueueFactory;

export function setQueueFactoryForTesting(
  fn: ((ctx: ToolExecutionContext) => SignalEmissionQueue | null) | null,
): void {
  queueFactory = fn ?? defaultQueueFactory;
  queues.clear();
}

export function getQueueForConnector(
  ctx: ToolExecutionContext,
): SignalEmissionQueue | null {
  if (!modeBEnabled(ctx)) return null;

  const existing = queues.get(ctx.connectorId);
  if (existing) return existing.queue;

  const queue = queueFactory(ctx);
  if (!queue) return null;

  const started = queue
    .start()
    .then((verdict) => ({ allowed: verdict.allowed }));
  queues.set(ctx.connectorId, { queue, started });
  return queue;
}

function defaultQueueFactory(
  ctx: ToolExecutionContext,
): SignalEmissionQueue | null {
  const client = createLoreVaultClient({
    knowledgeSpaceId: ctx.config.lorevaultKnowledgeSpaceId,
  });
  return new SignalEmissionQueue({ client });
}

function modeBEnabled(ctx: ToolExecutionContext): boolean {
  const flag = ctx.config.signalEmissionEnabled;
  // Default to enabled when KS + Vault are both configured.
  const haveScope =
    !!ctx.config.lorevaultKnowledgeSpaceId && !!ctx.config.lorevaultVaultId;
  if (flag === undefined) return haveScope;
  if (typeof flag === "string") {
    return haveScope && flag.toLowerCase() === "true";
  }
  return haveScope && !!flag;
}

function emissionConfig(ctx: ToolExecutionContext): EmissionConfig | null {
  const knowledgeSpaceId = ctx.config.lorevaultKnowledgeSpaceId;
  const vaultId = ctx.config.lorevaultVaultId;
  if (!knowledgeSpaceId || !vaultId) return null;
  return {
    knowledgeSpaceId,
    vaultId,
    sourceInstance: ctx.config.portalId ?? "",
  };
}

// ---------------------------------------------------------------------------
// HOC: wrap an emitting tool handler
// ---------------------------------------------------------------------------

export function withSignalEmission(
  toolName: EmittingToolName,
  inner: (ctx: ToolExecutionContext) => Promise<ToolExecutionResult>,
): (ctx: ToolExecutionContext) => Promise<ToolExecutionResult> {
  return async (ctx) => {
    const result = await inner(ctx);
    if (!result.success) return result;
    try {
      emitForTool(toolName, ctx, result);
    } catch (err) {
      // Emission is best-effort. We log but never fail the tool response.
      getLogger().warn(
        { err, toolName, connectorId: ctx.connectorId },
        "Mode B emission threw synchronously; tool response unaffected",
      );
    }
    return result;
  };
}

function emitForTool(
  toolName: EmittingToolName,
  ctx: ToolExecutionContext,
  result: ToolExecutionResult,
): void {
  const config = emissionConfig(ctx);
  if (!config) return;
  const queue = getQueueForConnector(ctx);
  if (!queue) return;

  const envelope = buildEnvelopeForTool(toolName, {
    ctx,
    result: result.data,
    config,
  });
  if (!envelope) {
    getLogger().warn(
      { toolName, connectorId: ctx.connectorId },
      "Mode B envelope builder produced no envelope; skipping",
    );
    return;
  }
  queue.enqueue(envelope);
}

/**
 * Test/admin helper — clears the per-connector queue registry so the next
 * tool call rebuilds (or skips) a queue with current config.
 */
export function resetQueuesForTesting(): void {
  queues.clear();
}
