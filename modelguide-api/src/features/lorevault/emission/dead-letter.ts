/**
 * In-memory dead-letter store for the LoreVault signal emission queue.
 *
 * Phase 2 scope. Production wires a Drizzle-backed table; do not build
 * that here. The interface lets the queue swap implementations later
 * without touching its retry logic.
 */

import type { DeadLetterEntry, DeadLetterStore } from "./types";

export class InMemoryDeadLetterStore implements DeadLetterStore {
  private readonly entries: DeadLetterEntry[] = [];

  add(entry: DeadLetterEntry): void {
    this.entries.push(entry);
  }

  list(limit?: number): DeadLetterEntry[] {
    if (limit === undefined) return [...this.entries];
    return this.entries.slice(-limit);
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
