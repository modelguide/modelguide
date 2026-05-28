/**
 * Mode C ingest end-to-end (against MockLoreVaultClient).
 *
 * Verifies:
 *   - canonical source_id = `{tenant_id}:hubspot:{object_type}:{object_id}`
 *   - tickets render to markdown with the thread inline
 *   - the runner walks pages, batches into ingestDocuments, and updates
 *     watermarks per Phase 0 §1.2
 *   - re-running on the same canonical identity produces no duplicate
 *     documents in mock state (idempotent upsert)
 *   - incremental sync respects the persisted watermark
 */

import { describe, expect, test } from "bun:test";
import type { HubSpotKnowledgeArticle } from "@features/connectors/catalog/hubspot/handlers";
import {
  type CorpusIngestConfig,
  type HubSpotIngestSource,
  InMemoryWatermarkStore,
  type Page,
  runIncrementalSync,
  runInitialBackfill,
} from "@features/connectors/catalog/hubspot/ingest";
import {
  HUBSPOT_SOURCE_SYSTEM,
  deriveSourceId,
} from "@features/connectors/catalog/hubspot/ingest/canonical-identity";
import {
  type HubSpotContactWithContext,
  type HubSpotTicketWithThread,
  renderTicketAsMarkdown,
} from "@features/connectors/catalog/hubspot/ingest/renderers";
import { FIXTURE_IDS } from "@features/lorevault/fixtures";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

const VAULT_ID = FIXTURE_IDS.vaultId;
const PORTAL_ID = "98765";

const REPRESENTATIVE_TICKET: HubSpotTicketWithThread = {
  id: "1001",
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-27T12:00:00.000Z",
  properties: {
    subject: "Login failure on Aura portal",
    content: "Customer cannot complete MFA flow after v3.4 release.",
    hs_pipeline: "p_support",
    hs_pipeline_stage: "s_open",
    hs_ticket_priority: "HIGH",
    hs_ticket_category: "AUTH",
    hubspot_owner_id: "owner_7",
    createdate: "2026-05-01T10:00:00.000Z",
    hs_lastmodifieddate: "2026-05-27T12:00:00.000Z",
  },
  thread: [
    {
      id: "m1",
      type: "MESSAGE",
      direction: "INCOMING",
      createdAt: "2026-05-01T10:00:00.000Z",
      senders: [
        {
          name: "Jane Operator",
          deliveryIdentifier: { value: "jane@aura.example" },
        },
      ],
      text: "Hit a hard error on MFA after the v3.4 release.",
    },
    {
      id: "m2",
      type: "MESSAGE",
      direction: "OUTGOING",
      createdAt: "2026-05-01T11:15:00.000Z",
      senders: [{ name: "Aura Support" }],
      text: "Investigating — we'll have an update by EOD.",
    },
  ],
};

const REPRESENTATIVE_KB: HubSpotKnowledgeArticle = {
  id: "kb_42",
  name: "Resetting MFA",
  language: "en",
  state: "PUBLISHED",
  url: "https://aura.example/kb/resetting-mfa",
  htmlBody: "<p>Step 1: visit the portal.</p><p>Step 2: choose reset.</p>",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-15T00:00:00.000Z",
};

const REPRESENTATIVE_CONTACT: HubSpotContactWithContext = {
  id: "5001",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-05-27T12:00:00.000Z",
  properties: {
    firstname: "Jane",
    lastname: "Operator",
    email: "jane@aura.example",
    phone: "+1-555-0100",
    company: "Aura Industries",
    lifecyclestage: "customer",
  },
  primaryCompany: {
    id: "co_900",
    properties: { name: "Aura Industries", domain: "aura.example" },
  },
  recentTickets: [
    {
      id: "1001",
      properties: { subject: "Login failure", hs_pipeline_stage: "s_open" },
    },
  ],
};

class FakeSource implements HubSpotIngestSource {
  public ticketsServed = 0;
  public kbServed = 0;
  public contactsServed = 0;

  constructor(
    private readonly tickets: HubSpotTicketWithThread[] = [
      REPRESENTATIVE_TICKET,
    ],
    private readonly articles: HubSpotKnowledgeArticle[] = [REPRESENTATIVE_KB],
    private readonly contacts: HubSpotContactWithContext[] = [
      REPRESENTATIVE_CONTACT,
    ],
  ) {}

  async listTickets(params: {
    updatedSince?: string;
    limit: number;
  }): Promise<Page<HubSpotTicketWithThread>> {
    const items = filterUpdatedSince(this.tickets, params.updatedSince);
    this.ticketsServed += items.length;
    return { items };
  }
  async listKnowledgeArticles(params: {
    updatedSince?: string;
    limit: number;
  }): Promise<Page<HubSpotKnowledgeArticle>> {
    const items = filterUpdatedSince(this.articles, params.updatedSince);
    this.kbServed += items.length;
    return { items };
  }
  async listContacts(params: {
    updatedSince?: string;
    limit: number;
  }): Promise<Page<HubSpotContactWithContext>> {
    const items = filterUpdatedSince(this.contacts, params.updatedSince);
    this.contactsServed += items.length;
    return { items };
  }
}

function filterUpdatedSince<T extends { updatedAt?: string }>(
  items: T[],
  updatedSince: string | undefined,
): T[] {
  if (!updatedSince) return items;
  return items.filter((i) => !i.updatedAt || i.updatedAt > updatedSince);
}

const CONFIG: CorpusIngestConfig = {
  knowledgeSpaceId: FIXTURE_IDS.knowledgeSpaceId,
  vaultId: VAULT_ID,
  sourceInstance: PORTAL_ID,
};

// ---------------------------------------------------------------------------
// Canonical identity
// ---------------------------------------------------------------------------

describe("canonical identity", () => {
  test("source_id format matches Phase 0 §1.2", () => {
    expect(
      deriveSourceId({
        tenantId: VAULT_ID,
        objectType: "ticket",
        objectId: "1001",
      }),
    ).toBe(`${VAULT_ID}:${HUBSPOT_SOURCE_SYSTEM}:ticket:1001`);
  });
});

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

describe("renderTicketAsMarkdown", () => {
  test("emits a markdown document with thread + properties header", () => {
    const doc = renderTicketAsMarkdown(REPRESENTATIVE_TICKET, {
      tenantId: VAULT_ID,
      sourceInstance: PORTAL_ID,
    });
    expect(doc.source_id).toBe(`${VAULT_ID}:hubspot:ticket:1001`);
    expect(doc.title).toBe("Login failure on Aura portal");
    expect(doc.content).toContain("# Ticket #1001");
    expect(doc.content).toContain("## Properties");
    expect(doc.content).toContain("## Conversation thread");
    expect(doc.content).toContain("Jane Operator");
    expect(doc.content).toContain(
      "Investigating — we'll have an update by EOD.",
    );
    expect(doc.metadata.source_system).toBe("hubspot");
    expect(doc.metadata.source_instance).toBe(PORTAL_ID);
  });
});

// ---------------------------------------------------------------------------
// Initial backfill — full corpus walk
// ---------------------------------------------------------------------------

describe("runInitialBackfill", () => {
  test("renders all three entity types, calls ingestDocuments end-to-end", async () => {
    const client = new MockLoreVaultClient();
    const source = new FakeSource();

    const result = await runInitialBackfill(source, client, CONFIG);
    expect(result.totals.ticket.documents).toBe(1);
    expect(result.totals.knowledge_article.documents).toBe(1);
    expect(result.totals.contact.documents).toBe(1);

    expect(client.state.documents.size).toBe(3);
    const ids = [...client.state.documents.keys()].sort();
    expect(ids).toContain(`${VAULT_ID}:hubspot:ticket:1001`);
    expect(ids).toContain(`${VAULT_ID}:hubspot:knowledge_article:kb_42`);
    expect(ids).toContain(`${VAULT_ID}:hubspot:contact:5001`);
  });

  test("re-running the backfill upserts on source_id (idempotent)", async () => {
    const client = new MockLoreVaultClient();
    const source = new FakeSource();

    await runInitialBackfill(source, client, CONFIG);
    const sizeAfterFirst = client.state.documents.size;
    const ticketBefore = client.state.documents.get(
      `${VAULT_ID}:hubspot:ticket:1001`,
    );

    await runInitialBackfill(source, client, CONFIG);
    expect(client.state.documents.size).toBe(sizeAfterFirst);

    const ticketAfter = client.state.documents.get(
      `${VAULT_ID}:hubspot:ticket:1001`,
    );
    expect(ticketAfter?.revision).toBe((ticketBefore?.revision ?? 0) + 1);
    expect(ticketAfter?.first_ingested_at).toBe(
      ticketBefore?.first_ingested_at,
    );
  });
});

// ---------------------------------------------------------------------------
// Incremental sync — watermark filtering
// ---------------------------------------------------------------------------

describe("runIncrementalSync", () => {
  test("skips items unchanged since the persisted watermark", async () => {
    const client = new MockLoreVaultClient();
    const source = new FakeSource();
    const watermarks = new InMemoryWatermarkStore();

    await runIncrementalSync(source, client, CONFIG, watermarks);
    expect(source.ticketsServed).toBe(1);

    // Second pass with the same input: watermark now equals the ticket's
    // updatedAt, so the source returns nothing.
    const beforeSecondTickets = source.ticketsServed;
    await runIncrementalSync(source, client, CONFIG, watermarks);
    expect(source.ticketsServed).toBe(beforeSecondTickets);
  });
});
