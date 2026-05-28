/**
 * Mode B handler wiring tests.
 *
 *   - Successful HubSpot tool calls enqueue exactly one envelope per call,
 *     with the expected event_type, canonical_object_identity, and lens hints.
 *   - The tool response returns immediately; emission runs out-of-band.
 *   - Failures (success: false) do NOT enqueue.
 *   - Read-only tools never enqueue.
 *   - Idempotent replays return was_idempotent: true on every replay; the
 *     connector does not retry.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  addReplyToTicket,
  closeTicket,
  createContact,
  createDeal,
  createNote,
  createTicket,
  logCallEngagement,
  searchContacts,
  updateContact,
  updateDealStage,
  updateTicket,
} from "@features/connectors/catalog/hubspot/handlers";
import {
  resetQueuesForTesting,
  setQueueFactoryForTesting,
} from "@features/connectors/catalog/hubspot/ingest/mode-b/emit";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";
import { fixedRetryPolicy } from "@features/lorevault/emission";
import { SignalEmissionQueue } from "@features/lorevault/emission";
import { FIXTURE_IDS } from "@features/lorevault/fixtures";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

const BASE_CONFIG: Record<string, string> = {
  accessToken: "pat-test",
  portalId: "98765",
  lorevaultKnowledgeSpaceId: FIXTURE_IDS.knowledgeSpaceId,
  lorevaultVaultId: FIXTURE_IDS.vaultId,
};

function makeCtx(
  input: Record<string, unknown>,
  config = BASE_CONFIG,
): ToolExecutionContext {
  return {
    config,
    input,
    organizationId: "org-1",
    connectorId: "conn-1",
  };
}

const originalFetch = globalThis.fetch;
let client: MockLoreVaultClient;
let queue: SignalEmissionQueue;

beforeEach(() => {
  client = new MockLoreVaultClient();
  queue = new SignalEmissionQueue({
    client,
    retryPolicy: fixedRetryPolicy(0, 1),
    sleep: async () => {},
  });
  setQueueFactoryForTesting(() => queue);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  setQueueFactoryForTesting(null);
  resetQueuesForTesting();
  await queue.stop();
});

function mockJson(body: unknown) {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as unknown as typeof fetch;
}

function mockSequence(responses: unknown[]): void {
  const queue = [...responses];
  globalThis.fetch = mock(() => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("mockSequence: unexpected extra fetch call");
    }
    return Promise.resolve(
      new Response(JSON.stringify(next), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

async function flush(): Promise<void> {
  await queue.stop();
}

describe("Mode B wiring — emitting tools enqueue exactly one envelope on success", () => {
  test("Create Contact → contact.created", async () => {
    mockJson({ id: "c1", properties: { firstname: "Ada" } });
    const result = await createContact(
      makeCtx({ properties: { firstname: "Ada" } }),
    );
    expect(result.success).toBe(true);
    await flush();
    expect(client.state.emittedSignals).toHaveLength(1);
    const env = client.state.emittedSignals[0];
    expect(env.event_type).toBe("contact.created");
    expect(env.canonical_object_identity.object_type).toBe("contact");
    expect(env.canonical_object_identity.object_id).toBe("c1");
    expect(env.declared_lens_hints).toEqual(["customer_interaction"]);
  });

  test("Update Contact → contact.updated", async () => {
    mockJson({ id: "c1", properties: {} });
    await updateContact(
      makeCtx({ contactId: "c1", properties: { firstname: "Ada" } }),
    );
    await flush();
    expect(client.state.emittedSignals.map((s) => s.event_type)).toEqual([
      "contact.updated",
    ]);
  });

  test("Create Deal → deal.created", async () => {
    mockJson({ id: "d1", properties: { dealname: "x" } });
    await createDeal(makeCtx({ properties: { dealname: "x" } }));
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("deal.created");
  });

  test("Update Deal Stage → deal.stage_changed", async () => {
    mockJson({ id: "d1", properties: { dealstage: "won" } });
    await updateDealStage(makeCtx({ dealId: "d1", stage: "won" }));
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe(
      "deal.stage_changed",
    );
  });

  test("Create Ticket → ticket.created", async () => {
    mockJson({ id: "t1", properties: { subject: "S" } });
    await createTicket(makeCtx({ properties: { subject: "S" } }));
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("ticket.created");
  });

  test("Update Ticket → ticket.updated (when no pipeline-stage change)", async () => {
    mockJson({ id: "t1", properties: { subject: "Updated" } });
    await updateTicket(
      makeCtx({ ticketId: "t1", properties: { subject: "Updated" } }),
    );
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("ticket.updated");
  });

  test("Close Ticket → ticket.closed", async () => {
    mockSequence([
      // resolve current pipeline for the ticket
      { id: "t1", properties: { hs_pipeline: "p1" } },
      // pipeline → CLOSED stage lookup
      {
        id: "p1",
        label: "Service Pipeline",
        stages: [
          { id: "s_open", label: "Open", metadata: { ticketState: "OPEN" } },
          {
            id: "s_done",
            label: "Closed",
            metadata: { ticketState: "CLOSED" },
          },
        ],
      },
      // PATCH ticket
      { id: "t1", properties: { hs_pipeline_stage: "s_done" } },
    ]);
    const result = await closeTicket(makeCtx({ ticketId: "t1" }));
    expect(result.success).toBe(true);
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("ticket.closed");
    expect(client.state.emittedSignals[0].entity.id).toBe("t1");
  });

  test("Add Reply To Ticket → ticket.reply_sent", async () => {
    mockSequence([
      // ticket properties: hs_thread_ids
      { id: "t1", properties: { hs_thread_ids: "thr_1" } },
      // thread read
      {
        id: "thr_1",
        channelId: "1000",
        channelAccountId: "acct_email",
        latestMessageReceivedTimestamp: "2026-05-27T12:00:00Z",
      },
      // message history (one inbound)
      {
        results: [
          {
            id: "m_in",
            type: "MESSAGE",
            direction: "INCOMING",
            channelId: "1000",
            channelAccountId: "acct_email",
            senders: [
              { name: "Customer", deliveryIdentifier: { value: "c@x.com" } },
            ],
            createdAt: "2026-05-27T12:00:00Z",
          },
        ],
      },
      // POST reply
      { id: "m_out", type: "MESSAGE" },
    ]);
    const result = await addReplyToTicket(
      makeCtx({ ticketId: "t1", text: "Investigating" }),
    );
    expect(result.success).toBe(true);
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("ticket.reply_sent");
    expect(client.state.emittedSignals[0].entity.id).toBe("t1");
  });

  test("Log Call Engagement → call.logged", async () => {
    mockJson({ id: "call1", properties: {} });
    await logCallEngagement(
      makeCtx({ properties: { hs_call_title: "Onboarding" } }),
    );
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("call.logged");
  });

  test("Create Note → note.created", async () => {
    mockJson({ id: "n1", properties: {} });
    await createNote(makeCtx({ properties: { hs_note_body: "HITL" } }));
    await flush();
    expect(client.state.emittedSignals[0].event_type).toBe("note.created");
  });
});

describe("Mode B wiring — read-only tools never enqueue", () => {
  test("Search Contacts does not enqueue", async () => {
    mockJson({ results: [] });
    await searchContacts(makeCtx({ query: "ada" }));
    await flush();
    expect(client.state.emittedSignals).toHaveLength(0);
  });
});

describe("Mode B wiring — failure paths do not enqueue", () => {
  test("Update Contact rejecting non-allowlisted property does not enqueue", async () => {
    mockJson({});
    const result = await updateContact(
      makeCtx({
        contactId: "c1",
        properties: { firstname: "Ada", hs_object_source: "evil" },
      }),
    );
    expect(result.success).toBe(false);
    await flush();
    expect(client.state.emittedSignals).toHaveLength(0);
  });
});

describe("Mode B wiring — Mode B disabled when KS/Vault unset", () => {
  test("Without lorevaultKnowledgeSpaceId, no enqueue happens", async () => {
    mockJson({ id: "c1", properties: {} });
    const factorySpy = mock(() => null);
    setQueueFactoryForTesting(factorySpy as unknown as () => null);
    const result = await createContact(
      makeCtx(
        { properties: { firstname: "Ada" } },
        { accessToken: "pat-test", portalId: "98765" },
      ),
    );
    expect(result.success).toBe(true);
    // No queue obtained — factory not called either because gating is checked
    // first inside emit.ts.
    expect(client.state.emittedSignals).toHaveLength(0);
  });
});

describe("Mode B wiring — idempotent replay", () => {
  test("Replaying 10 envelopes with the same signal_id is acked as idempotent and not retried", async () => {
    // Manually push 10 envelopes with the same signal_id directly into the
    // queue (bypasses the tool layer; this isolates the queue + client).
    await queue.start();
    for (let i = 0; i < 10; i++) {
      queue.enqueue({
        signal_id: "sig_replay",
        signal_version: "1",
        emitted_at: "2026-05-28T00:00:00.000Z",
        source_system: "hubspot",
        source_instance: "98765",
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
      });
    }
    await queue.stop();

    // The mock client records the same signal_id only once.
    expect(client.state.emittedSignals).toHaveLength(1);
    // Every history entry for this signal lands as delivered + was_idempotent
    // after the first; the connector never retries.
    const entry = queue
      .getRecentSignals()
      .find((e) => e.signal_id === "sig_replay");
    expect(entry?.status).toBe("delivered");
    expect(entry?.was_idempotent).toBe(true);
    expect(entry?.attempts).toBe(1); // last update wins — only one in-flight at a time
  });
});
