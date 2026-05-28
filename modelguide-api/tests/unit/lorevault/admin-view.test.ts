/**
 * Admin "Show Recent Signals" view (spec §11 acceptance criterion).
 */

import { describe, expect, test } from "bun:test";
import type { SignalEvent } from "@features/lorevault/client";
import {
  SignalEmissionQueue,
  fixedRetryPolicy,
  getRecentSignalsView,
} from "@features/lorevault/emission";
import { FIXTURE_IDS } from "@features/lorevault/fixtures";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

function envelope(signalId: string, eventType = "ticket.created"): SignalEvent {
  return {
    signal_id: signalId,
    signal_version: "1",
    emitted_at: "2026-05-28T00:00:00.000Z",
    source_system: "hubspot",
    source_instance: "portal_98765",
    knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
    vault_id: FIXTURE_IDS.vaultId,
    event_type: eventType,
    entity: { type: "ticket", id: "1" },
    actor: { type: "ai_agent", id: "conn-1" },
    declared_lens_hints: ["operational_workflow"],
    canonical_object_identity: {
      tenant_id: FIXTURE_IDS.vaultId,
      source_system: "hubspot",
      object_type: "ticket",
      object_id: "1",
    },
    payload: { snapshot: {} },
  };
}

describe("getRecentSignalsView", () => {
  test("returns delivery status for each emitted signal, newest first, plus stats", async () => {
    const client = new MockLoreVaultClient({
      // Send 1 to succeed, 2 to throw once then succeed, 3 to fail every time
      // (capped by maxAttempts) → dead-lettered.
      emitSignalScript: [
        null, // sig_a delivered
        () => {
          throw new Error("transient");
        },
        null, // sig_b second attempt succeeds
        () => {
          throw new Error("permanent");
        },
        () => {
          throw new Error("permanent");
        },
      ],
    });
    const queue = new SignalEmissionQueue({
      client,
      retryPolicy: fixedRetryPolicy(0, 2),
      sleep: async () => {},
    });
    await queue.start();
    queue.enqueue(envelope("sig_a"));
    queue.enqueue(envelope("sig_b"));
    queue.enqueue(envelope("sig_c"));
    await queue.stop();

    const view = getRecentSignalsView(queue);
    expect(view.signals).toHaveLength(3);
    const byId = Object.fromEntries(view.signals.map((s) => [s.signal_id, s]));
    expect(byId.sig_a.status).toBe("delivered");
    expect(byId.sig_b.status).toBe("delivered");
    expect(byId.sig_b.attempts).toBe(2);
    expect(byId.sig_c.status).toBe("dead_lettered");
    expect(byId.sig_c.attempts).toBe(2);

    expect(view.stats.deadLettered).toBe(1);
    expect(view.stats.entitlementAllowed).toBe(true);
  });

  test("limit caps the result count", async () => {
    const client = new MockLoreVaultClient();
    const queue = new SignalEmissionQueue({
      client,
      sleep: async () => {},
    });
    await queue.start();
    for (let i = 0; i < 5; i++) queue.enqueue(envelope(`sig_${i}`));
    await queue.stop();
    expect(getRecentSignalsView(queue, 2).signals).toHaveLength(2);
  });
});
