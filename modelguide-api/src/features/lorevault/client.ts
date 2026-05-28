/**
 * LoreVault integration client — the thin-adapter pattern from Phase 0
 * Contract §3.
 *
 * Wevn binds *only* to this interface. Two implementations:
 *   - `MockLoreVaultClient` — fixture-backed, used today.
 *   - `HttpLoreVaultClient` — wraps the real /external/v1/... endpoints,
 *      stubbed until Wave 1 ships.
 *
 * Switching implementations is a one-line change (see fixtures/binding).
 *
 * Source of truth for shapes: Phase 0 Integration Contract.md §1.
 * Do NOT extend types beyond what the contract locks. If a field is
 * unclear, surface it; do not guess.
 */

// ---------------------------------------------------------------------------
// Locked enums (Phase 0 §1.5, §1.6, §1.8)
// ---------------------------------------------------------------------------

export type LensId =
  | "customer_interaction"
  | "operational_workflow"
  | "knowledge_integrity"
  | "revenue_intelligence"
  | "risk_compliance"
  | "narrative_intelligence";

export type NarrativeLifecycleState =
  | "emerging"
  | "active"
  | "deteriorating"
  | "stabilized"
  | "resolved"
  | "monitoring";

export type EvidenceResolutionState =
  | "pending_resolution"
  | "resolved"
  | "permanently_unresolved"
  | "orphaned_after_resolution";

export type SignalPolarity = "concern" | "health";

export type DefaultWeightSource = "lorevault_substrate" | "wevn_default";

export type SubscriptionTier = "starter" | "pro" | "enterprise";

// ---------------------------------------------------------------------------
// Signal ingest envelope (Phase 0 §1.1)
// ---------------------------------------------------------------------------

export type ActorType = "ai_agent" | "human" | "system";

export interface SignalActor {
  type: ActorType;
  id: string;
  name?: string;
}

export interface SignalEntity {
  type: string;
  id: string;
  portal_url?: string;
}

export interface CanonicalObjectIdentity {
  tenant_id: string;
  source_system: string;
  object_type: string;
  object_id: string;
}

export interface SignalEvidenceRef {
  type: "document" | "chunk";
  dataset_id: string;
  id: string;
  resolution_status?: EvidenceResolutionState;
}

export interface SignalPayload {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  properties_changed?: string[];
  text?: string;
}

export interface SignalEvent {
  signal_id: string;
  signal_version: "1";
  emitted_at: string;
  source_system: string;
  source_instance: string;
  knowledge_space_id: string;
  vault_id: string;
  event_type: string;
  entity: SignalEntity;
  actor: SignalActor;
  declared_lens_hints: LensId[];
  canonical_object_identity: CanonicalObjectIdentity;
  payload: SignalPayload;
  evidence_refs?: SignalEvidenceRef[];
}

export interface SignalAcceptResponse {
  signal_id: string;
  accepted: true;
  was_idempotent: boolean;
}

export interface BatchAcceptResponse {
  accepted: SignalAcceptResponse[];
  rejected: Array<{ signal_id: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Document ingest envelope (Phase 0 §1.2, §1.3)
// ---------------------------------------------------------------------------

export interface DocumentMetadata {
  source_system: string;
  source_instance: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  last_modified_at: string;
  [extra: string]: unknown;
}

export interface IngestDocument {
  /**
   * Canonical upsert key: `{tenant_id}:{source_system}:{object_type}:{object_id}`.
   * Same canonical identity → same document, idempotent.
   */
  source_id: string;
  title: string;
  content: string;
  metadata: DocumentMetadata;
}

export interface DocumentIngestRequest {
  knowledge_space_id: string;
  dataset_id: string;
  documents: IngestDocument[];
}

export interface IngestionJobAcceptResponse {
  ingestion_job_id: string;
  accepted_count: number;
  rejected_count: number;
  rejection_reasons: Array<{ source_id: string; reason: string }>;
}

export type IngestionJobState = "queued" | "running" | "complete" | "failed";

export interface IngestionJobStatus {
  ingestion_job_id: string;
  state: IngestionJobState;
  knowledge_space_id: string;
  dataset_id: string;
  bytes_requested: number;
  bytes_processed: number;
  document_count: number;
  started_at: string;
  completed_at?: string;
  rejection_reasons?: Array<{ source_id: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Query (Phase 0 §1.4)
// ---------------------------------------------------------------------------

export interface SignalAwareQuery {
  knowledge_space_id: string;
  match: {
    lens?: LensId[];
    signal?: string[];
    score_min?: number;
    score_max?: number;
    entity?: { type: string; id: string };
    time_window?: { since: string; until?: string };
  };
  return: {
    evidence_chunks?: boolean;
    group_by?: "signal" | "lens" | "entity";
    include_contributing_documents?: boolean;
    limit?: number;
  };
}

export interface QueryEvidenceChunk {
  chunk_id: string;
  source_document_id: string;
  source_uri?: string;
  raw_text: string;
  signal_id: string;
  raw_score: number;
  polarity: SignalPolarity;
  lens: LensId;
  extracted_at: string;
}

export interface QueryResponse {
  knowledge_space_id: string;
  evidence: QueryEvidenceChunk[];
  group_by?: "signal" | "lens" | "entity";
  groups?: Array<{ key: string; chunk_ids: string[] }>;
  next_cursor?: string;
}

// ---------------------------------------------------------------------------
// Narratives (Phase 0 §1.5)
// ---------------------------------------------------------------------------

export interface NarrativeFilter {
  knowledge_space_id: string;
  lifecycle_state?: NarrativeLifecycleState[];
  primary_lens?: LensId[];
  active?: boolean;
  limit?: number;
  cursor?: string;
  if_modified_since?: string;
}

export interface NarrativeSummary {
  narrative_id: string;
  title: string;
  knowledge_space_id: string;
  lifecycle_state: NarrativeLifecycleState;
  active: boolean;
  confidence: number;
  priority: number;
  primary_lens: LensId;
  contributing_lenses: Array<{ lens: LensId; weight: number }>;
  contributing_entities: Array<{ type: string; id: string }>;
  evidence_count: number;
  created_at: string;
  last_transitioned_at: string;
  investigation_prompts?: string[];
}

export interface NarrativeListResponse {
  narratives: NarrativeSummary[];
  total: number;
  next_cursor?: string;
}

export interface NarrativeDetailResponse extends NarrativeSummary {
  contributing_signal_ids: string[];
}

export interface EvidenceChainItem {
  chunk_id: string;
  source_document_id: string;
  source_uri?: string;
  raw_text: string;
  signal_id: string;
  signal_raw_score: number;
  signal_polarity: SignalPolarity;
  chunk_score: number;
  status: "live" | "orphaned";
  extracted_at: string;
}

export interface EvidenceChainResponse {
  narrative_id: string;
  evidence: EvidenceChainItem[];
}

export interface SignalEvidenceResponse {
  signal_id: string;
  evidence: EvidenceChainItem[];
}

// ---------------------------------------------------------------------------
// Pack catalog (Phase 0 §1.6)
// ---------------------------------------------------------------------------

export interface PackSignal {
  signal_id: string;
  polarity: SignalPolarity;
  raw_score_range: { min: number; max: number };
  default_weight: number;
  default_weight_source: DefaultWeightSource;
  operator_visible: boolean;
  maturity_tier: "stable" | "experimental" | "deprecated";
  registered_entity_types: string[];
}

export interface Pack {
  pack_id: string;
  name: string;
  description: string;
  ontology_version: string;
  enabled: boolean;
  signals_contributed: PackSignal[];
}

export interface PackCatalogResponse {
  packs: Pack[];
}

// ---------------------------------------------------------------------------
// Entitlements (Phase 0 §1.7)
// ---------------------------------------------------------------------------

export interface QuotaUsage {
  limit: number;
  used: number;
}

export interface EntitlementResponse {
  vault_id: string;
  knowledge_space_id: string;
  tier: SubscriptionTier;
  features: {
    osi_enabled: boolean;
    lssr_enabled: boolean;
  };
  quotas: {
    monthly_signal_events: QuotaUsage;
    monthly_ingest_mb: QuotaUsage;
    monthly_query_count: QuotaUsage;
  };
}

// ---------------------------------------------------------------------------
// Health (Phase 0 §1, Wave 1)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  version?: string;
  checked_at: string;
}

// ---------------------------------------------------------------------------
// Interface — the only surface Wevn binds to
// ---------------------------------------------------------------------------

export interface LoreVaultIntegrationClient {
  // Signal ingest
  emitSignal(event: SignalEvent): Promise<SignalAcceptResponse>;
  emitSignalsBatch(events: SignalEvent[]): Promise<BatchAcceptResponse>;

  // Document ingest
  ingestDocuments(
    payload: DocumentIngestRequest,
  ): Promise<IngestionJobAcceptResponse>;
  getIngestionJob(id: string): Promise<IngestionJobStatus>;

  // Query + narratives
  query(payload: SignalAwareQuery): Promise<QueryResponse>;
  listNarratives(filter: NarrativeFilter): Promise<NarrativeListResponse>;
  getNarrative(id: string): Promise<NarrativeDetailResponse>;
  getNarrativeEvidence(id: string): Promise<EvidenceChainResponse>;
  getSignalEvidence(id: string): Promise<SignalEvidenceResponse>;

  // Catalog + tenant
  getEntitlements(): Promise<EntitlementResponse>;
  getPacks(): Promise<PackCatalogResponse>;
  getHealth(): Promise<HealthResponse>;
}
