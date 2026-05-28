/**
 * Shared types for the LoreVault signal emission subsystem.
 */

import type { SignalEvent } from "../client";

export type DeliveryStatus =
  | "pending"
  | "in_flight"
  | "delivered"
  | "retrying"
  | "dead_lettered"
  | "gated";

export interface SignalHistoryEntry {
  signal_id: string;
  event_type: string;
  emitted_at: string;
  status: DeliveryStatus;
  attempts: number;
  /** Whether the delivery hit LoreVault idempotency (Phase 0 §1.9). */
  was_idempotent?: boolean;
  /** Last error captured during retry, if any. */
  last_error?: string;
  /** When the entry was last updated by the worker. */
  updated_at: string;
}

export interface DeadLetterEntry {
  envelope: SignalEvent;
  attempts: number;
  last_error: string;
  dead_lettered_at: string;
}

export interface DeadLetterStore {
  add(entry: DeadLetterEntry): void;
  list(limit?: number): DeadLetterEntry[];
  size(): number;
}

export interface RetryPolicy {
  /** Maximum number of attempts including the first try. */
  maxAttempts: number;
  /**
   * Returns the delay in milliseconds before the *next* attempt.
   * `attempt` is zero-indexed (0 = right after the first failure).
   */
  delayMs(attempt: number): number;
}
