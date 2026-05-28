/**
 * HttpLoreVaultClient — STUB. Establishes the binding symbol used by the
 * adapter swap-test; throws on every call until Wave 1 ships.
 *
 * Wave 1 endpoint surface (per Phase 0 §1 / Concurrent Workstream Plan §4):
 *   POST /external/v1/signals (+ /signals:batch)
 *   POST /external/v1/ingest/documents
 *   GET  /external/v1/ingest/jobs/{id}
 *   POST /external/v1/query
 *   GET  /external/v1/narratives + /{id} + /{id}/evidence
 *   GET  /external/v1/signals/{id}/evidence
 *   GET  /external/v1/packs
 *   GET  /external/v1/entitlements
 *   GET  /external/v1/health
 *
 * Bind to this client by swapping the export in `./binding.ts` — no
 * application code change.
 */

import type {
  BatchAcceptResponse,
  DocumentIngestRequest,
  EntitlementResponse,
  EvidenceChainResponse,
  HealthResponse,
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

export interface HttpLoreVaultClientConfig {
  baseUrl: string;
  apiKey: string;
  knowledgeSpaceId: string;
}

const NOT_IMPLEMENTED = "Not implemented; bound after Wave 1 ships.";

export class HttpLoreVaultClient implements LoreVaultIntegrationClient {
  /** Retained for the eventual real implementation. Today the stub throws
   * on every call, so the config is never read. */
  readonly config: HttpLoreVaultClientConfig;

  constructor(config: HttpLoreVaultClientConfig) {
    this.config = config;
  }

  async emitSignal(_event: SignalEvent): Promise<SignalAcceptResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async emitSignalsBatch(_events: SignalEvent[]): Promise<BatchAcceptResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async ingestDocuments(
    _payload: DocumentIngestRequest,
  ): Promise<IngestionJobAcceptResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getIngestionJob(_id: string): Promise<IngestionJobStatus> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async query(_payload: SignalAwareQuery): Promise<QueryResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async listNarratives(
    _filter: NarrativeFilter,
  ): Promise<NarrativeListResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getNarrative(_id: string): Promise<NarrativeDetailResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getNarrativeEvidence(_id: string): Promise<EvidenceChainResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getSignalEvidence(_id: string): Promise<SignalEvidenceResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getEntitlements(): Promise<EntitlementResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getPacks(): Promise<PackCatalogResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getHealth(): Promise<HealthResponse> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
