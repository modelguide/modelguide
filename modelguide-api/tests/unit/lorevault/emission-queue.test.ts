/**
 * SignalEmissionQueue tests.
 *
 * Covers:
 *   - happy path: enqueue → delivered, status reflected in history
 *   - idempotent ack: was_idempotent: true logged + no retry
 *   - retry on transient failure: 2 fails then success
 *   - dead-letter after max attempts: 6 fails → DLQ entry
 *   - getStats reports pending / in-flight / dead-lettered
 *   - admin view (getRecentSignalsView) reports delivery state
 */

import { describe, expect, test } from "bun:test";
import type { SignalEvent } from "@features/lorevault/client";
import {
  InMemoryDeadLetterStore,
  SignalEmissionQueue,
  fixedRetryPolicy,
  getRecentSignalsView,
} from "@features/lorevault/emission";
import { FIXTURE_IDS } from "@features/lorevault/fixtures";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

function makeEnvelope(overrides: Partial<SignalEvent> = {}): SignalEvent {
  return {
    signal_id:
      overrides.signal_id ?? `sig_${Math.random().toString(36).slice(2, 10)}`,
    signal_version: "1",
    emitted_at: "2026-05-28T00:00:00.000Z",
    source_system: "hubspot",
    source_instance: "portal_98765",
    knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
    vault_id: FIXTURE_IDS.vaultId,
    event_type: "ticket.created",
    entity: { type: "ticket", id: "1001" },
    actor: { type: "ai_agent", id: "conn-1" },
    declared_lens_hints: ["operational_workflow"],
    canonical_object_identity: {
      tenant_id: FIXTURE_IDS.vaultId,
      source_system: "hubspot",
      object_type: "ticket",
      object_id: "1001",
    },
    payload: { snapshot: { subject: "Test" } },
    ...overrides,
  };
}

const NO_SLEEP = (_ms: number) => Promise.resolve();

describe("SignalEmissionQueue — happy path", () => {
  test("envelope flows pending → in_flight → delivered", async () => {
    const client = new MockLoreVaultClient();
    const queue = new SignalEmissionQueue({
      client,
      sleep: NO_SLEEP,
      retryPolicy: fixedRetryPolicy(0, 1),
    });
    await queue.start();

    queue.enqueue(makeEnvelope({ signal_id: "sig_happy_1" }));
    await queue.stop();

    expect(client.state.emittedSignals.map((s) => s.signal_id)).toEqual([
      "sig_happy_1",
    ]);
    const view = getRecentSignalsView(queue);
    expect(view.signals.length).toBe(1);
    expect(view.signals[0].status).toBe("delivered");
    expect(view.signals[0].attempts).toBe(1);
    expect(view.stats.deadLettered).toBe(0);
  });

  test("idempotent ack is captured (was_idempotent: true) without retry", async () => {
    const client = new MockLoreVaultClient();
    // Pre-seed an emission so the second delivery is idempotent.
    await client.emitSignal(makeEnvelope({ signal_id: "sig_idem_1" }));

    const queue = new SignalEmissionQueue({
      client,
      sleep: NO_SLEEP,
    });
    await queue.start();
    queue.enqueue(makeEnvelope({ signal_id: "sig_idem_1" }));
    await queue.stop();

    const entry = queue
      .getRecentSignals()
      .find((e) => e.signal_id === "sig_idem_1");
    expect(entry?.status).toBe("delivered");
    expect(entry?.was_idempotent).toBe(true);
    expect(entry?.attempts).toBe(1);
  });
});

describe("SignalEmissionQueue — retry behavior", () => {
  test("retries with backoff and ultimately succeeds after 2 transient failures", async () => {
    const client = new MockLoreVaultClient({
      emitSignalScript: [
        () => {
          throw new Error("transient: 500");
        },
        () => {
          throw new Error("transient: 503");
        },
        null, // fall through to default success behavior
      ],
    });
    const sleeps: number[] = [];
    const queue = new SignalEmissionQueue({
      client,
      retryPolicy: fixedRetryPolicy(10, 6),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await queue.start();
    queue.enqueue(makeEnvelope({ signal_id: "sig_retry_1" }));
    await queue.stop();

    const entry = queue
      .getRecentSignals()
      .find((e) => e.signal_id === "sig_retry_1");
    expect(entry?.status).toBe("delivered");
    expect(entry?.attempts).toBe(3);
    expect(sleeps).toEqual([10, 10]);
    expect(client.state.emittedSignals.map((s) => s.signal_id)).toEqual([
      "sig_retry_1",
    ]);
    expect(queue.getStats().deadLettered).toBe(0);
  });
});

describe("SignalEmissionQueue — dead-letter", () => {
  test("after maxAttempts failures the envelope lands in the dead-letter store", async () => {
    const client = new MockLoreVaultClient({
      emitSignalScript: Array.from({ length: 6 }, () => () => {
        throw new Error("permanent");
      }),
    });
    const dlq = new InMemoryDeadLetterStore();
    const queue = new SignalEmissionQueue({
      client,
      retryPolicy: fixedRetryPolicy(0, 6),
      deadLetterStore: dlq,
      sleep: NO_SLEEP,
    });
    await queue.start();
    queue.enqueue(makeEnvelope({ signal_id: "sig_dlq_1" }));
    await queue.stop();

    expect(dlq.size()).toBe(1);
    const [entry] = dlq.list();
    expect(entry.envelope.signal_id).toBe("sig_dlq_1");
    expect(entry.attempts).toBe(6);
    expect(entry.last_error).toContain("permanent");

    const historyEntry = queue
      .getRecentSignals()
      .find((e) => e.signal_id === "sig_dlq_1");
    expect(historyEntry?.status).toBe("dead_lettered");
    expect(historyEntry?.attempts).toBe(6);
    expect(queue.getStats().deadLettered).toBe(1);
  });
});

describe("SignalEmissionQueue — stats", () => {
  test("getStats reports running and entitlementAllowed after start", async () => {
    const client = new MockLoreVaultClient();
    const queue = new SignalEmissionQueue({ client, sleep: NO_SLEEP });
    expect(queue.getStats().running).toBe(false);
    await queue.start();
    expect(queue.getStats().running).toBe(true);
    expect(queue.getStats().entitlementAllowed).toBe(true);
    await queue.stop();
    expect(queue.getStats().running).toBe(false);
  });
});
