/**
 * Admin surface for the LoreVault signal emission subsystem.
 *
 * Internal — NOT exposed as an MCP tool. Fulfills the
 * "Show Recent Signals admin view" acceptance criterion in HubSpot
 * Connector Spec §11.
 *
 * Returns the most recent N (default 100) emitted signals with their
 * delivery status: pending | in_flight | delivered (with was_idempotent)
 * | retrying | dead_lettered | gated.
 */

import type { SignalEmissionQueue } from "./queue";
import type { SignalHistoryEntry } from "./types";

export interface RecentSignalsView {
  signals: SignalHistoryEntry[];
  stats: {
    pending: number;
    inFlight: number;
    deadLettered: number;
    entitlementAllowed: boolean;
    running: boolean;
  };
}

export function getRecentSignalsView(
  queue: SignalEmissionQueue,
  limit = 100,
): RecentSignalsView {
  return {
    signals: queue.getRecentSignals(limit),
    stats: queue.getStats(),
  };
}
