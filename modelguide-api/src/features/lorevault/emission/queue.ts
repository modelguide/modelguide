/**
 * In-process signal emission queue (HubSpot Connector Spec §7.2).
 *
 *   - Tool handlers `enqueue()` envelopes and return immediately.
 *   - A worker drains the queue and calls `LoreVaultIntegrationClient.emitSignal`.
 *   - On failure the worker re-enqueues with exponential backoff up to
 *     `RetryPolicy.maxAttempts`; exhausted envelopes land in the
 *     `DeadLetterStore`.
 *   - On startup, the queue calls `getEntitlements()` exactly once and
 *     fail-closes if the vault is Starter-tier or has `osi_enabled: false`.
 *     Subsequent enqueues are no-ops with a single log.
 *
 * Concurrency: at most one in-flight `emitSignal` call at a time per queue
 * instance. This bounds backpressure inside one connector process; production
 * can scale by running multiple queues per Org if needed.
 */

import { getLogger } from "@lib/logger";
import type { LoreVaultIntegrationClient, SignalEvent } from "../client";
import { InMemoryDeadLetterStore } from "./dead-letter";
import {
  type EntitlementVerdict,
  checkEntitlement,
  logVerdict,
} from "./entitlement-gate";
import { SignalHistory } from "./history";
import { defaultRetryPolicy } from "./retry";
import type { DeadLetterStore, RetryPolicy, SignalHistoryEntry } from "./types";

export interface SignalEmissionQueueOptions {
  client: LoreVaultIntegrationClient;
  retryPolicy?: RetryPolicy;
  deadLetterStore?: DeadLetterStore;
  history?: SignalHistory;
  /** Sleep override for tests. Defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock override for tests. */
  now?: () => Date;
}

interface QueueItem {
  envelope: SignalEvent;
  attempts: number;
}

export class SignalEmissionQueue {
  private readonly client: LoreVaultIntegrationClient;
  private readonly retryPolicy: RetryPolicy;
  private readonly deadLetterStore: DeadLetterStore;
  private readonly history: SignalHistory;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  private readonly pending: QueueItem[] = [];
  private inFlightCount = 0;
  private running = false;
  private workerPromise: Promise<void> | null = null;
  private entitlementChecked = false;
  private entitlementAllowed = false;
  private entitlementReason: string | undefined;
  private notifyEnqueue: (() => void) | null = null;

  constructor(options: SignalEmissionQueueOptions) {
    this.client = options.client;
    this.retryPolicy = options.retryPolicy ?? defaultRetryPolicy;
    this.deadLetterStore =
      options.deadLetterStore ?? new InMemoryDeadLetterStore();
    this.history = options.history ?? new SignalHistory();
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Run the entitlement check and (if allowed) start the worker loop.
   * Safe to call multiple times — only the first call has effect.
   */
  async start(): Promise<EntitlementVerdict> {
    const verdict = await this.ensureEntitlementChecked();
    logVerdict(verdict);
    if (!verdict.allowed) return verdict;

    if (!this.running) {
      this.running = true;
      this.workerPromise = this.worker();
    }
    return verdict;
  }

  /**
   * Stop accepting new work and wait for in-flight + queued items to drain.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.notifyEnqueue?.();
    if (this.workerPromise) {
      await this.workerPromise;
      this.workerPromise = null;
    }
  }

  /**
   * Add an envelope to the queue. Never blocks the caller.
   * If the entitlement gate has already denied Mode B, the envelope is
   * silently dropped with one history entry tagged `gated` so the admin
   * view shows why.
   */
  enqueue(envelope: SignalEvent): void {
    if (this.entitlementChecked && !this.entitlementAllowed) {
      this.history.record({
        signal_id: envelope.signal_id,
        event_type: envelope.event_type,
        emitted_at: envelope.emitted_at,
        status: "gated",
      });
      this.history.update(envelope.signal_id, {
        last_error: this.entitlementReason,
      });
      return;
    }
    this.history.record({
      signal_id: envelope.signal_id,
      event_type: envelope.event_type,
      emitted_at: envelope.emitted_at,
      status: "pending",
    });
    this.pending.push({ envelope, attempts: 0 });
    this.notifyEnqueue?.();
  }

  /**
   * Snapshot of queue health for the admin endpoint and tests.
   */
  getStats(): {
    pending: number;
    inFlight: number;
    deadLettered: number;
    entitlementAllowed: boolean;
    running: boolean;
  } {
    return {
      pending: this.pending.length,
      inFlight: this.inFlightCount,
      deadLettered: this.deadLetterStore.size(),
      entitlementAllowed: this.entitlementAllowed,
      running: this.running,
    };
  }

  /**
   * Recent signal history (admin "Show Recent Signals" view, spec §11).
   * Defaults to the last 100; newest first.
   */
  getRecentSignals(limit?: number): SignalHistoryEntry[] {
    return this.history.list(limit);
  }

  getDeadLetterStore(): DeadLetterStore {
    return this.deadLetterStore;
  }

  isEntitled(): boolean {
    return this.entitlementChecked && this.entitlementAllowed;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async ensureEntitlementChecked(): Promise<EntitlementVerdict> {
    if (this.entitlementChecked) {
      return this.entitlementAllowed
        ? { allowed: true, entitlements: undefined as never }
        : { allowed: false, reason: this.entitlementReason ?? "" };
    }
    const verdict = await checkEntitlement(this.client);
    this.entitlementChecked = true;
    this.entitlementAllowed = verdict.allowed;
    if (!verdict.allowed) this.entitlementReason = verdict.reason;
    return verdict;
  }

  private async worker(): Promise<void> {
    while (this.running || this.pending.length > 0 || this.inFlightCount > 0) {
      const next = this.pending.shift();
      if (!next) {
        if (!this.running) return;
        await this.waitForEnqueue();
        continue;
      }
      this.inFlightCount += 1;
      try {
        await this.deliver(next);
      } finally {
        this.inFlightCount -= 1;
      }
    }
  }

  private async deliver(item: QueueItem): Promise<void> {
    const log = getLogger();
    item.attempts += 1;
    this.history.update(item.envelope.signal_id, {
      status: "in_flight",
      attempts: item.attempts,
    });

    try {
      const ack = await this.client.emitSignal(item.envelope);
      this.history.update(item.envelope.signal_id, {
        status: "delivered",
        attempts: item.attempts,
        was_idempotent: ack.was_idempotent,
      });
      if (ack.was_idempotent) {
        log.info(
          { signal_id: item.envelope.signal_id },
          "signal delivery acked as idempotent replay; no retry scheduled",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (item.attempts >= this.retryPolicy.maxAttempts) {
        log.error(
          { signal_id: item.envelope.signal_id, attempts: item.attempts, err },
          "signal delivery exhausted retries; dead-lettering",
        );
        this.deadLetterStore.add({
          envelope: item.envelope,
          attempts: item.attempts,
          last_error: message,
          dead_lettered_at: this.now().toISOString(),
        });
        this.history.update(item.envelope.signal_id, {
          status: "dead_lettered",
          attempts: item.attempts,
          last_error: message,
        });
        return;
      }
      // Schedule retry via the configured backoff.
      const delay = this.retryPolicy.delayMs(item.attempts - 1);
      this.history.update(item.envelope.signal_id, {
        status: "retrying",
        attempts: item.attempts,
        last_error: message,
      });
      log.warn(
        {
          signal_id: item.envelope.signal_id,
          attempts: item.attempts,
          delay_ms: delay,
          err,
        },
        "signal delivery failed; scheduling retry",
      );
      await this.sleep(delay);
      // Re-queue at the head so retries don't starve behind fresh work.
      this.pending.unshift(item);
      this.notifyEnqueue?.();
    }
  }

  private waitForEnqueue(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.notifyEnqueue = () => {
        this.notifyEnqueue = null;
        resolve();
      };
    });
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
