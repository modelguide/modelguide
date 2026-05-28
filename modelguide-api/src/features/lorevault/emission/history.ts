/**
 * Bounded ring buffer that tracks the most recent N emitted signals plus
 * their delivery status. Backs the admin "Show Recent Signals" view
 * (HubSpot Connector Spec §11 acceptance criterion).
 */

import type { DeliveryStatus, SignalHistoryEntry } from "./types";

export interface SignalHistoryOptions {
  /** Maximum number of entries retained. Default 100 per spec §11. */
  capacity?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export class SignalHistory {
  private readonly capacity: number;
  private readonly now: () => Date;
  private readonly bySignalId = new Map<string, SignalHistoryEntry>();
  private readonly order: string[] = [];

  constructor(options: SignalHistoryOptions = {}) {
    this.capacity = options.capacity ?? 100;
    this.now = options.now ?? (() => new Date());
  }

  record(initial: {
    signal_id: string;
    event_type: string;
    emitted_at: string;
    status: DeliveryStatus;
  }): void {
    if (this.bySignalId.has(initial.signal_id)) {
      this.update(initial.signal_id, { status: initial.status });
      return;
    }
    const entry: SignalHistoryEntry = {
      ...initial,
      attempts: 0,
      updated_at: this.now().toISOString(),
    };
    this.bySignalId.set(initial.signal_id, entry);
    this.order.push(initial.signal_id);
    while (this.order.length > this.capacity) {
      const evictId = this.order.shift();
      if (evictId) this.bySignalId.delete(evictId);
    }
  }

  update(
    signalId: string,
    patch: Partial<
      Pick<
        SignalHistoryEntry,
        "status" | "attempts" | "was_idempotent" | "last_error"
      >
    >,
  ): void {
    const entry = this.bySignalId.get(signalId);
    if (!entry) return;
    Object.assign(entry, patch, { updated_at: this.now().toISOString() });
  }

  list(limit?: number): SignalHistoryEntry[] {
    const all = this.order
      .map((id) => this.bySignalId.get(id))
      .filter((e): e is SignalHistoryEntry => !!e);
    const newestFirst = all.slice().reverse();
    return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
  }

  size(): number {
    return this.bySignalId.size;
  }
}
