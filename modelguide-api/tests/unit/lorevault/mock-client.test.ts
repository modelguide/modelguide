/**
 * MockLoreVaultClient unit tests — verifies fixture contract conformance
 * and the idempotent upsert behavior the Mode C ingest path depends on.
 */

import { describe, expect, test } from "bun:test";
import { FIXTURE_IDS } from "@features/lorevault/fixtures";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

describe("MockLoreVaultClient", () => {
  test("emitSignal is idempotent on signal_id", async () => {
    const client = new MockLoreVaultClient();
    const event = {
      signal_id: "sig_001",
      signal_version: "1" as const,
      emitted_at: "2026-05-28T00:00:00.000Z",
      source_system: "hubspot",
      source_instance: "portal_98765",
      knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
      vault_id: FIXTURE_IDS.vaultId,
      event_type: "ticket.created",
      entity: { type: "ticket", id: "100" },
      actor: { type: "ai_agent" as const, id: "agent_1" },
      declared_lens_hints: ["operational_workflow" as const],
      canonical_object_identity: {
        tenant_id: FIXTURE_IDS.vaultId,
        source_system: "hubspot",
        object_type: "ticket",
        object_id: "100",
      },
      payload: { snapshot: { subject: "x" } },
    };

    const first = await client.emitSignal(event);
    expect(first.was_idempotent).toBe(false);

    const second = await client.emitSignal(event);
    expect(second.was_idempotent).toBe(true);

    expect(client.state.emittedSignals).toHaveLength(1);
  });

  test("ingestDocuments upserts on source_id (idempotent re-run)", async () => {
    const client = new MockLoreVaultClient();
    const payload = {
      knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
      dataset_id: "hubspot-tickets",
      documents: [
        {
          source_id: `${FIXTURE_IDS.vaultId}:hubspot:ticket:1001`,
          title: "Ticket 1001",
          content: "first revision",
          metadata: {
            source_system: "hubspot",
            source_instance: "portal_98765",
            entity_type: "ticket",
            entity_id: "1001",
            created_at: "2026-05-01T00:00:00.000Z",
            last_modified_at: "2026-05-01T00:00:00.000Z",
          },
        },
      ],
    };

    await client.ingestDocuments(payload);
    await client.ingestDocuments({
      ...payload,
      documents: [{ ...payload.documents[0], content: "second revision" }],
    });

    expect(client.state.documents.size).toBe(1);
    const stored = [...client.state.documents.values()][0];
    expect(stored.content).toBe("second revision");
    expect(stored.revision).toBe(2);
  });

  test("listNarratives returns fixtures keyed to FIXTURE_IDS.knowledgeSpaceId", async () => {
    const client = new MockLoreVaultClient();
    const empty = await client.listNarratives({
      knowledge_space_id: "ks_unknown",
    });
    expect(empty.narratives).toHaveLength(0);

    const all = await client.listNarratives({
      knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
    });
    expect(all.narratives.length).toBeGreaterThan(0);
    for (const n of all.narratives) {
      expect([
        "emerging",
        "active",
        "deteriorating",
        "stabilized",
        "resolved",
        "monitoring",
      ]).toContain(n.lifecycle_state);
    }
  });

  test("getPacks polarity entries use wevn_default until LSSR-010 ships", async () => {
    const client = new MockLoreVaultClient();
    const packs = await client.getPacks();
    expect(packs.packs.length).toBeGreaterThan(0);
    for (const pack of packs.packs) {
      for (const signal of pack.signals_contributed) {
        expect(["concern", "health"]).toContain(signal.polarity);
        expect(signal.default_weight_source).toBe("wevn_default");
      }
    }
  });

  test("getEntitlements returns the expected enterprise fixture", async () => {
    const client = new MockLoreVaultClient();
    const ent = await client.getEntitlements();
    expect(ent.tier).toBe("enterprise");
    expect(ent.features.osi_enabled).toBe(true);
  });

  test("getHealth returns ok", async () => {
    const client = new MockLoreVaultClient();
    const health = await client.getHealth();
    expect(health.status).toBe("ok");
  });

  test("evidence chain references use locked resolution states (live | orphaned)", async () => {
    const client = new MockLoreVaultClient();
    const nar = (
      await client.listNarratives({
        knowledge_space_id: FIXTURE_IDS.knowledgeSpaceId,
      })
    ).narratives[0];
    const evidence = await client.getNarrativeEvidence(nar.narrative_id);
    expect(evidence.evidence.length).toBeGreaterThan(0);
    for (const ev of evidence.evidence) {
      expect(["live", "orphaned"]).toContain(ev.status);
    }
  });
});
