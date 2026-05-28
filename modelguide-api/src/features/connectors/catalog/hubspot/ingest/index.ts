/**
 * HubSpot Mode C corpus ingest skeleton.
 *
 * Walks ticket / KB-article / contact corpora, renders each entity to
 * markdown, and pushes batches into LoreVault via the thin-adapter
 * `LoreVaultIntegrationClient` interface.
 *
 * Idempotency: documents are keyed by canonical `source_id` (Phase 0 §1.2).
 * Re-running with the same source on the same LoreVault state produces no
 * duplicate documents — the mock client upserts on `source_id`, and the
 * real HTTP client is contractually required to do the same.
 *
 * Out of scope for Phase 1 (stubbed):
 *   - Mode B (signal emission) — `enqueueSignal()` returns without doing
 *     anything; wave-2 work wires it to the queue + retry path.
 *   - Mode D (HubSpot webhooks) — not until post-POC.
 */

import { getLogger } from "@lib/logger";
import type {
  IngestDocument,
  IngestionJobAcceptResponse,
  LoreVaultIntegrationClient,
  SignalEvent,
} from "../../../../lorevault/client";
import type { HubSpotKnowledgeArticle } from "../handlers";
import { DATASET_IDS, type HubSpotObjectType } from "./canonical-identity";
import {
  type HubSpotContactWithContext,
  type HubSpotObject,
  type HubSpotTicketWithThread,
  renderContactAsMarkdown,
  renderKnowledgeArticleAsMarkdown,
  renderTicketAsMarkdown,
} from "./renderers";

// ---------------------------------------------------------------------------
// Source provider — pluggable HubSpot access surface.
// ---------------------------------------------------------------------------

export interface HubSpotIngestSource {
  listTickets(params: PaginationParams): Promise<Page<HubSpotTicketWithThread>>;
  listKnowledgeArticles(
    params: PaginationParams,
  ): Promise<Page<HubSpotKnowledgeArticle>>;
  listContacts(
    params: PaginationParams,
  ): Promise<Page<HubSpotContactWithContext>>;
}

export interface PaginationParams {
  after?: string;
  /** ISO-8601 watermark for incremental sync. Implementations filter on
   * lastModified ≥ watermark when present. */
  updatedSince?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  next?: string;
}

// ---------------------------------------------------------------------------
// Watermark tracking
// ---------------------------------------------------------------------------

export interface WatermarkStore {
  read(objectType: HubSpotObjectType): Promise<string | undefined>;
  write(objectType: HubSpotObjectType, watermark: string): Promise<void>;
}

/** In-memory watermark store. Production wires a Drizzle-backed store. */
export class InMemoryWatermarkStore implements WatermarkStore {
  private readonly map = new Map<HubSpotObjectType, string>();

  async read(objectType: HubSpotObjectType): Promise<string | undefined> {
    return this.map.get(objectType);
  }

  async write(objectType: HubSpotObjectType, watermark: string): Promise<void> {
    this.map.set(objectType, watermark);
  }
}

// ---------------------------------------------------------------------------
// Runner config + result
// ---------------------------------------------------------------------------

export interface CorpusIngestConfig {
  knowledgeSpaceId: string;
  /** Vault ID that doubles as `tenant_id` for canonical-identity derivation
   * (Phase 0 §1.1: `tenant_id = vault_id`). */
  vaultId: string;
  /** HubSpot portal ID. Becomes `source_instance` on emitted documents. */
  sourceInstance: string;
  /** Page size for HubSpot list calls. Default 100. */
  pageSize?: number;
  /** Batch size for LoreVault `ingestDocuments` calls. Default 25. */
  batchSize?: number;
  /** Entity types to ingest. Default: all three (ticket, knowledge_article, contact). */
  entityTypes?: Array<"ticket" | "knowledge_article" | "contact">;
}

export interface CorpusIngestResult {
  totals: Record<
    "ticket" | "knowledge_article" | "contact",
    {
      documents: number;
      jobs: string[];
    }
  >;
  watermarks: Partial<Record<HubSpotObjectType, string>>;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_BATCH_SIZE = 25;

// ---------------------------------------------------------------------------
// Main entry — full walk + incremental sync share the same code path,
// differentiated by whether the caller passes a `watermarkStore`.
// ---------------------------------------------------------------------------

/**
 * Run a full corpus walk. Equivalent to `runIncrementalSync` with an empty
 * watermark store — every entity is rendered and upserted by canonical
 * source_id. Re-runs are idempotent.
 */
export async function runInitialBackfill(
  source: HubSpotIngestSource,
  client: LoreVaultIntegrationClient,
  config: CorpusIngestConfig,
): Promise<CorpusIngestResult> {
  return runIngest(source, client, config, new InMemoryWatermarkStore());
}

/**
 * Run an incremental sync. Reads per-object watermarks from `watermarkStore`,
 * filters the HubSpot walk with `updatedSince`, and writes new watermarks at
 * the end of each entity's loop.
 */
export async function runIncrementalSync(
  source: HubSpotIngestSource,
  client: LoreVaultIntegrationClient,
  config: CorpusIngestConfig,
  watermarkStore: WatermarkStore,
): Promise<CorpusIngestResult> {
  return runIngest(source, client, config, watermarkStore);
}

async function runIngest(
  source: HubSpotIngestSource,
  client: LoreVaultIntegrationClient,
  config: CorpusIngestConfig,
  watermarkStore: WatermarkStore,
): Promise<CorpusIngestResult> {
  const log = getLogger();
  const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const entityTypes =
    config.entityTypes ?? (["ticket", "knowledge_article", "contact"] as const);

  const result: CorpusIngestResult = {
    totals: {
      ticket: { documents: 0, jobs: [] },
      knowledge_article: { documents: 0, jobs: [] },
      contact: { documents: 0, jobs: [] },
    },
    watermarks: {},
  };

  for (const type of entityTypes) {
    const watermark = await watermarkStore.read(type);
    log.info(
      { connector: "HubSpot", type, watermark },
      "Mode C ingest: walk start",
    );

    let nextWatermark = watermark ?? "";
    let cursor: string | undefined;
    do {
      const page = await fetchPage(source, type, {
        after: cursor,
        updatedSince: watermark,
        limit: pageSize,
      });

      for (let i = 0; i < page.items.length; i += batchSize) {
        const slice = page.items.slice(i, i + batchSize);
        const documents = slice.map((entity) =>
          renderEntity(type, entity, config),
        );
        if (documents.length === 0) continue;

        const job = await client.ingestDocuments({
          knowledge_space_id: config.knowledgeSpaceId,
          dataset_id: DATASET_IDS[entityToHubSpotObject(type)],
          documents,
        });
        recordJob(result, type, job);

        const sliceWatermark = pickHighestWatermark(slice);
        if (sliceWatermark && sliceWatermark > nextWatermark) {
          nextWatermark = sliceWatermark;
        }
      }

      cursor = page.next;
    } while (cursor);

    if (nextWatermark && nextWatermark !== (watermark ?? "")) {
      await watermarkStore.write(type, nextWatermark);
      result.watermarks[entityToHubSpotObject(type)] = nextWatermark;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mode B stub (per spec §10 / dispatch scope)
// ---------------------------------------------------------------------------

/**
 * Mode B signal emission entry point. Phase 1 is a no-op — the call is wired
 * so handlers can route signals here today without behavior changes when
 * Wave 2 lights up the queue + retry path.
 */
export async function enqueueSignal(
  _client: LoreVaultIntegrationClient,
  _event: SignalEvent,
): Promise<void> {
  // Intentional no-op: Mode B is out of scope for Phase 1.
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type EntityKey = "ticket" | "knowledge_article" | "contact";

function entityToHubSpotObject(type: EntityKey): HubSpotObjectType {
  return type;
}

async function fetchPage(
  source: HubSpotIngestSource,
  type: EntityKey,
  params: PaginationParams,
): Promise<
  Page<
    | HubSpotTicketWithThread
    | HubSpotKnowledgeArticle
    | HubSpotContactWithContext
  >
> {
  switch (type) {
    case "ticket":
      return source.listTickets(params);
    case "knowledge_article":
      return source.listKnowledgeArticles(params);
    case "contact":
      return source.listContacts(params);
  }
}

function renderEntity(
  type: EntityKey,
  entity:
    | HubSpotTicketWithThread
    | HubSpotKnowledgeArticle
    | HubSpotContactWithContext,
  config: CorpusIngestConfig,
): IngestDocument {
  const ctx = {
    tenantId: config.vaultId,
    sourceInstance: config.sourceInstance,
  };
  switch (type) {
    case "ticket":
      return renderTicketAsMarkdown(entity as HubSpotTicketWithThread, ctx);
    case "knowledge_article":
      return renderKnowledgeArticleAsMarkdown(
        entity as HubSpotKnowledgeArticle,
        ctx,
      );
    case "contact":
      return renderContactAsMarkdown(entity as HubSpotContactWithContext, ctx);
  }
}

function recordJob(
  result: CorpusIngestResult,
  type: EntityKey,
  job: IngestionJobAcceptResponse,
): void {
  result.totals[type].documents += job.accepted_count;
  result.totals[type].jobs.push(job.ingestion_job_id);
}

function pickHighestWatermark(
  items: Array<HubSpotObject | HubSpotKnowledgeArticle>,
): string {
  let highest = "";
  for (const item of items) {
    const candidate = pickItemTimestamp(item);
    if (candidate && candidate > highest) highest = candidate;
  }
  return highest;
}

function pickItemTimestamp(
  item: HubSpotObject | HubSpotKnowledgeArticle,
): string | undefined {
  if ("updatedAt" in item && typeof item.updatedAt === "string") {
    return item.updatedAt;
  }
  if ("properties" in item) {
    const props = (item.properties ?? {}) as Record<string, unknown>;
    const candidates = [
      props.hs_lastmodifieddate,
      props.lastmodifieddate,
      props.updatedAt,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c) return c;
    }
  }
  return undefined;
}
