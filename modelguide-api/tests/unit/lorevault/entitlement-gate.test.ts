/**
 * Entitlement fail-fast tests (Phase 0 §1.7 + spec §11).
 *
 *   - Starter-tier vault: gate denies, queue refuses to start the worker.
 *   - osi_enabled: false: gate denies.
 *   - Enterprise + osi_enabled: gate allows.
 *   - Gated enqueue is recorded in history as `gated` with the reason,
 *     not delivered, not retried.
 */

import { describe, expect, test } from "bun:test";
import type {
  EntitlementResponse,
  SignalEvent,
} from "@features/lorevault/client";
import {
  SignalEmissionQueue,
  checkEntitlement,
} from "@features/lorevault/emission";
import {
  FIXTURE_ENTITLEMENTS_STARTER,
  FIXTURE_IDS,
} from "@features/lorevault/fixtures";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

function makeEnvelope(): SignalEvent {
  return {
    signal_id: "sig_gated_1",
    signal_version: "1",
    emitted_at: "2026-05-28T00:00:00.000Z",
    source_system: "hubspot",
    source_instance: "portal_98765",
    knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
    vault_id: FIXTURE_IDS.vaultId,
    event_type: "ticket.created",
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

describe("checkEntitlement", () => {
  test("denies Starter tier", async () => {
    const client = new MockLoreVaultClient({
      entitlements: FIXTURE_ENTITLEMENTS_STARTER,
    });
    const verdict = await checkEntitlement(client);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toContain("Starter");
  });

  test("denies when features.osi_enabled is false even on a paid tier", async () => {
    const denied: EntitlementResponse = {
      vault_id: FIXTURE_IDS.vaultId,
      knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
      tier: "pro",
      features: { osi_enabled: false, lssr_enabled: true },
      quotas: {
        monthly_signal_events: { limit: 1000, used: 0 },
        monthly_ingest_mb: { limit: 100, used: 0 },
        monthly_query_count: { limit: 1000, used: 0 },
      },
    };
    const client = new MockLoreVaultClient({ entitlements: denied });
    const verdict = await checkEntitlement(client);
    expect(verdict.allowed).toBe(false);
  });

  test("allows Enterprise + osi_enabled", async () => {
    const client = new MockLoreVaultClient();
    const verdict = await checkEntitlement(client);
    expect(verdict.allowed).toBe(true);
  });
});

describe("SignalEmissionQueue + Starter entitlements", () => {
  test("Mode B refuses to start; enqueues are recorded as gated and never delivered", async () => {
    const client = new MockLoreVaultClient({
      entitlements: FIXTURE_ENTITLEMENTS_STARTER,
    });
    const queue = new SignalEmissionQueue({ client });

    const verdict = await queue.start();
    expect(verdict.allowed).toBe(false);
    expect(queue.getStats().running).toBe(false);
    expect(queue.isEntitled()).toBe(false);

    queue.enqueue(makeEnvelope());
    // Nothing delivered; gated history entry recorded.
    expect(client.state.emittedSignals).toHaveLength(0);
    const entry = queue
      .getRecentSignals()
      .find((e) => e.signal_id === "sig_gated_1");
    expect(entry?.status).toBe("gated");
    expect(entry?.last_error).toContain("Starter");

    await queue.stop();
  });
});
