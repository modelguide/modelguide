/**
 * MockLoreVaultClient — fixture-backed implementation of
 * `LoreVaultIntegrationClient`. Used by Wevn build today; Wave-1
 * HTTP client swaps in transparently when LoreVault ships.
 *
 * Behavior:
 *   - `emitSignal` records the event in-memory and is idempotent on
 *     `signal_id` (Phase 0 §1.9 — replay is observational, no state
 *     resurrection, no side-effect re-firing).
 *   - `ingestDocuments` upserts on `source_id` so re-running Mode C
 *     produces no duplicates.
 *   - All other reads return deterministic fixture data from
 *     `./fixtures/index.ts`.
 */

import type {
  BatchAcceptResponse,
  DocumentIngestRequest,
  EntitlementResponse,
  EvidenceChainResponse,
  HealthResponse,
  IngestDocument,
  IngestionJobAcceptResponse,
  IngestionJobStatus,
  LoreVaultIntegrationClient,
  NarrativeDetailResponse,
  NarrativeFilter,
  NarrativeListResponse,
  PackCatalogResponse,
  QueryResponse,
  SignalAcceptResponse,
  SignalAwareQuery,
  SignalEvent,
  SignalEvidenceResponse,
} from "./client";
import {
  FIXTURE_ENTITLEMENTS,
  FIXTURE_HEALTH,
  FIXTURE_IDS,
  FIXTURE_NARRATIVES,
  FIXTURE_NARRATIVE_EVIDENCE,
  FIXTURE_NARRATIVE_LIST,
  FIXTURE_PACKS,
  FIXTURE_QUERY_RESPONSE,
  FIXTURE_SIGNAL_EVIDENCE,
} from "./fixtures";

interface StoredDocument {
  source_id: string;
  dataset_id: string;
  knowledge_space_id: string;
  title: string;
  content: string;
  metadata: IngestDocument["metadata"];
  first_ingested_at: string;
  last_ingested_at: string;
  revision: number;
}

interface StoredJob extends IngestionJobStatus {
  source_ids: string[];
}

export interface MockState {
  emittedSignals: SignalEvent[];
  documents: Map<string, StoredDocument>;
  jobs: Map<string, StoredJob>;
}

export interface MockClientOptions {
  /**
   * Deterministic clock for tests. Defaults to a frozen fixture timestamp so
   * the mock never depends on `Date.now()`.
   */
  now?: () => Date;
  /** Deterministic ID factory for jobs / job IDs. */
  newId?: (prefix: string) => string;
}

const DEFAULT_NOW = () => new Date("2026-05-28T00:00:00.000Z");

export class MockLoreVaultClient implements LoreVaultIntegrationClient {
  readonly state: MockState = {
    emittedSignals: [],
    documents: new Map(),
    jobs: new Map(),
  };

  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;
  private seq = 0;

  constructor(options: MockClientOptions = {}) {
    this.now = options.now ?? DEFAULT_NOW;
    this.newId =
      options.newId ??
      ((prefix: string) =>
        `${prefix}_${(++this.seq).toString().padStart(6, "0")}`);
  }

  // -------------------------------------------------------------------------
  // Signal ingest
  // -------------------------------------------------------------------------

  async emitSignal(event: SignalEvent): Promise<SignalAcceptResponse> {
    const alreadySeen = this.state.emittedSignals.some(
      (e) => e.signal_id === event.signal_id,
    );
    if (!alreadySeen) {
      this.state.emittedSignals.push(event);
    }
    return {
      signal_id: event.signal_id,
      accepted: true,
      was_idempotent: alreadySeen,
    };
  }

  async emitSignalsBatch(events: SignalEvent[]): Promise<BatchAcceptResponse> {
    const accepted: SignalAcceptResponse[] = [];
    for (const event of events) {
      accepted.push(await this.emitSignal(event));
    }
    return { accepted, rejected: [] };
  }

  // -------------------------------------------------------------------------
  // Document ingest (idempotent upsert on source_id)
  // -------------------------------------------------------------------------

  async ingestDocuments(
    payload: DocumentIngestRequest,
  ): Promise<IngestionJobAcceptResponse> {
    const nowIso = this.now().toISOString();
    const rejection_reasons: Array<{ source_id: string; reason: string }> = [];
    let accepted_count = 0;
    const sourceIds: string[] = [];
    let bytes_requested = 0;

    for (const doc of payload.documents) {
      bytes_requested += Buffer.byteLength(doc.content ?? "", "utf8");
      if (!doc.source_id) {
        rejection_reasons.push({
          source_id: doc.source_id,
          reason: "source_id is required",
        });
        continue;
      }
      const existing = this.state.documents.get(doc.source_id);
      const stored: StoredDocument = {
        source_id: doc.source_id,
        dataset_id: payload.dataset_id,
        knowledge_space_id: payload.knowledge_space_id,
        title: doc.title,
        content: doc.content,
        metadata: doc.metadata,
        first_ingested_at: existing?.first_ingested_at ?? nowIso,
        last_ingested_at: nowIso,
        revision: (existing?.revision ?? 0) + 1,
      };
      this.state.documents.set(doc.source_id, stored);
      sourceIds.push(doc.source_id);
      accepted_count += 1;
    }

    const ingestion_job_id = this.newId("job");
    const job: StoredJob = {
      ingestion_job_id,
      state: "complete",
      knowledge_space_id: payload.knowledge_space_id,
      dataset_id: payload.dataset_id,
      bytes_requested,
      bytes_processed: bytes_requested,
      document_count: accepted_count,
      started_at: nowIso,
      completed_at: nowIso,
      rejection_reasons: rejection_reasons.length
        ? rejection_reasons
        : undefined,
      source_ids: sourceIds,
    };
    this.state.jobs.set(ingestion_job_id, job);

    return {
      ingestion_job_id,
      accepted_count,
      rejected_count: rejection_reasons.length,
      rejection_reasons,
    };
  }

  async getIngestionJob(id: string): Promise<IngestionJobStatus> {
    const job = this.state.jobs.get(id);
    if (!job) {
      throw new Error(`Mock ingestion job not found: ${id}`);
    }
    const { source_ids: _, ...status } = job;
    return status;
  }

  // -------------------------------------------------------------------------
  // Query + narratives (fixture data)
  // -------------------------------------------------------------------------

  async query(_payload: SignalAwareQuery): Promise<QueryResponse> {
    return FIXTURE_QUERY_RESPONSE;
  }

  async listNarratives(
    filter: NarrativeFilter,
  ): Promise<NarrativeListResponse> {
    if (filter.knowledge_space_id !== FIXTURE_IDS.knowledgeSpaceId) {
      return { narratives: [], total: 0 };
    }
    let narratives = FIXTURE_NARRATIVE_LIST.narratives;
    if (filter.lifecycle_state?.length) {
      narratives = narratives.filter((n) =>
        filter.lifecycle_state?.includes(n.lifecycle_state),
      );
    }
    if (filter.primary_lens?.length) {
      narratives = narratives.filter((n) =>
        filter.primary_lens?.includes(n.primary_lens),
      );
    }
    if (filter.active !== undefined) {
      narratives = narratives.filter((n) => n.active === filter.active);
    }
    const limit = filter.limit ?? narratives.length;
    return {
      narratives: narratives.slice(0, limit),
      total: narratives.length,
    };
  }

  async getNarrative(id: string): Promise<NarrativeDetailResponse> {
    const narrative = FIXTURE_NARRATIVES.find((n) => n.narrative_id === id);
    if (!narrative) {
      throw new Error(`Mock narrative not found: ${id}`);
    }
    return narrative;
  }

  async getNarrativeEvidence(id: string): Promise<EvidenceChainResponse> {
    const evidence = FIXTURE_NARRATIVE_EVIDENCE[id];
    if (!evidence) {
      throw new Error(`Mock narrative evidence not found: ${id}`);
    }
    return evidence;
  }

  async getSignalEvidence(id: string): Promise<SignalEvidenceResponse> {
    const evidence = FIXTURE_SIGNAL_EVIDENCE[id];
    if (!evidence) {
      throw new Error(`Mock signal evidence not found: ${id}`);
    }
    return evidence;
  }

  // -------------------------------------------------------------------------
  // Catalog / tenant
  // -------------------------------------------------------------------------

  async getEntitlements(): Promise<EntitlementResponse> {
    return FIXTURE_ENTITLEMENTS;
  }

  async getPacks(): Promise<PackCatalogResponse> {
    return FIXTURE_PACKS;
  }

  async getHealth(): Promise<HealthResponse> {
    return FIXTURE_HEALTH;
  }
}
