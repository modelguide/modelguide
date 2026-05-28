/**
 * Deterministic fixture data for the MockLoreVaultClient.
 *
 * Shapes conform to Phase 0 Integration Contract §1. Polarity values use
 * `default_weight_source: "wevn_default"` per the contract — LSSR-010-POLARITY
 * is locked but not yet shipped; consumers compute normalization until then.
 *
 * No timestamps are computed at module-load time. All timestamps are static
 * ISO strings so fixtures are stable across runs.
 */

import type {
  EntitlementResponse,
  EvidenceChainResponse,
  HealthResponse,
  NarrativeDetailResponse,
  NarrativeListResponse,
  Pack,
  PackCatalogResponse,
  QueryResponse,
  SignalEvidenceResponse,
} from "../client";

const FIXTURE_KS_ID = "ks_fixture_aura_poc";
const FIXTURE_VAULT_ID = "vault_fixture_aura";
const FIXTURE_TIMESTAMP = "2026-05-28T00:00:00.000Z";

export const FIXTURE_IDS = {
  knowledgeSpaceId: FIXTURE_KS_ID,
  vaultId: FIXTURE_VAULT_ID,
} as const;

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

const CUSTOMER_INTERACTION_PACK: Pack = {
  pack_id: "pack_customer_interaction_v1",
  name: "Customer Interaction",
  description:
    "Signals capturing customer sentiment, retention risk, and trust erosion across support and engagement surfaces.",
  ontology_version: "1.0.0",
  enabled: true,
  signals_contributed: [
    {
      signal_id: "retention_risk",
      polarity: "concern",
      raw_score_range: { min: 0, max: 100 },
      default_weight: 0.7,
      default_weight_source: "wevn_default",
      operator_visible: true,
      maturity_tier: "stable",
      registered_entity_types: ["contact", "company", "ticket"],
    },
    {
      signal_id: "trust_erosion",
      polarity: "concern",
      raw_score_range: { min: 0, max: 100 },
      default_weight: 0.6,
      default_weight_source: "wevn_default",
      operator_visible: true,
      maturity_tier: "stable",
      registered_entity_types: ["contact", "ticket"],
    },
    {
      signal_id: "positive_engagement",
      polarity: "health",
      raw_score_range: { min: 0, max: 100 },
      default_weight: 0.5,
      default_weight_source: "wevn_default",
      operator_visible: true,
      maturity_tier: "stable",
      registered_entity_types: ["contact", "engagement"],
    },
  ],
};

const OPERATIONAL_WORKFLOW_PACK: Pack = {
  pack_id: "pack_operational_workflow_v1",
  name: "Operational Workflow",
  description:
    "Signals capturing operational throughput, queue health, and ticket lifecycle anomalies.",
  ontology_version: "1.0.0",
  enabled: true,
  signals_contributed: [
    {
      signal_id: "queue_backlog",
      polarity: "concern",
      raw_score_range: { min: 0, max: 100 },
      default_weight: 0.5,
      default_weight_source: "wevn_default",
      operator_visible: true,
      maturity_tier: "stable",
      registered_entity_types: ["ticket"],
    },
    {
      signal_id: "first_response_breach",
      polarity: "concern",
      raw_score_range: { min: 0, max: 100 },
      default_weight: 0.8,
      default_weight_source: "wevn_default",
      operator_visible: true,
      maturity_tier: "stable",
      registered_entity_types: ["ticket"],
    },
  ],
};

const REVENUE_INTELLIGENCE_PACK: Pack = {
  pack_id: "pack_revenue_intelligence_v1",
  name: "Revenue Intelligence",
  description:
    "Signals capturing pipeline progression, deal velocity, and stage-time-in-stage anomalies.",
  ontology_version: "1.0.0",
  enabled: true,
  signals_contributed: [
    {
      signal_id: "deal_slippage",
      polarity: "concern",
      raw_score_range: { min: 0, max: 100 },
      default_weight: 0.7,
      default_weight_source: "wevn_default",
      operator_visible: true,
      maturity_tier: "experimental",
      registered_entity_types: ["deal"],
    },
  ],
};

export const FIXTURE_PACKS: PackCatalogResponse = {
  packs: [
    CUSTOMER_INTERACTION_PACK,
    OPERATIONAL_WORKFLOW_PACK,
    REVENUE_INTELLIGENCE_PACK,
  ],
};

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export const FIXTURE_ENTITLEMENTS: EntitlementResponse = {
  vault_id: FIXTURE_VAULT_ID,
  knowledge_space_id: FIXTURE_KS_ID,
  tier: "enterprise",
  features: {
    osi_enabled: true,
    lssr_enabled: true,
  },
  quotas: {
    monthly_signal_events: { limit: 1_000_000, used: 12_345 },
    monthly_ingest_mb: { limit: 5_120, used: 412 },
    monthly_query_count: { limit: 50_000, used: 187 },
  },
};

// Starter-tier fixture — used by entitlement fail-fast tests (Phase 0 §1.7
// + HubSpot Connector Spec §11). Starter excludes OSI, so Mode B must
// refuse to start when this is the entitlement response.
export const FIXTURE_ENTITLEMENTS_STARTER: EntitlementResponse = {
  vault_id: FIXTURE_VAULT_ID,
  knowledge_space_id: FIXTURE_KS_ID,
  tier: "starter",
  features: {
    osi_enabled: false,
    lssr_enabled: false,
  },
  quotas: {
    monthly_signal_events: { limit: 0, used: 0 },
    monthly_ingest_mb: { limit: 512, used: 0 },
    monthly_query_count: { limit: 0, used: 0 },
  },
};

// ---------------------------------------------------------------------------
// Narratives + evidence
// ---------------------------------------------------------------------------

const NARRATIVE_A: NarrativeDetailResponse = {
  narrative_id: "nar_aura_retention_001",
  title: "Repeated login failures correlating with retention risk in cohort A",
  knowledge_space_id: FIXTURE_KS_ID,
  lifecycle_state: "active",
  active: true,
  confidence: 0.82,
  priority: 3,
  primary_lens: "customer_interaction",
  contributing_lenses: [
    { lens: "customer_interaction", weight: 0.6 },
    { lens: "operational_workflow", weight: 0.4 },
  ],
  contributing_entities: [
    { type: "ticket", id: "hubspot:ticket:1001" },
    { type: "ticket", id: "hubspot:ticket:1002" },
    { type: "contact", id: "hubspot:contact:5001" },
  ],
  evidence_count: 12,
  created_at: FIXTURE_TIMESTAMP,
  last_transitioned_at: FIXTURE_TIMESTAMP,
  investigation_prompts: [
    "Are these contacts on the same identity provider?",
    "Have any of these tickets been routed to escalation?",
  ],
  contributing_signal_ids: [
    "sig_fixture_retention_001",
    "sig_fixture_first_response_breach_002",
  ],
};

const NARRATIVE_B: NarrativeDetailResponse = {
  narrative_id: "nar_aura_pipeline_002",
  title: "Mid-funnel deal slippage in Q2 cohort",
  knowledge_space_id: FIXTURE_KS_ID,
  lifecycle_state: "emerging",
  active: true,
  confidence: 0.65,
  priority: 2,
  primary_lens: "revenue_intelligence",
  contributing_lenses: [{ lens: "revenue_intelligence", weight: 1.0 }],
  contributing_entities: [{ type: "deal", id: "hubspot:deal:7001" }],
  evidence_count: 4,
  created_at: FIXTURE_TIMESTAMP,
  last_transitioned_at: FIXTURE_TIMESTAMP,
  investigation_prompts: ["Was a stage gate misconfigured for this cohort?"],
  contributing_signal_ids: ["sig_fixture_deal_slippage_003"],
};

export const FIXTURE_NARRATIVES: NarrativeDetailResponse[] = [
  NARRATIVE_A,
  NARRATIVE_B,
];

export const FIXTURE_NARRATIVE_LIST: NarrativeListResponse = {
  narratives: FIXTURE_NARRATIVES.map(
    ({ contributing_signal_ids: _, ...summary }) => summary,
  ),
  total: FIXTURE_NARRATIVES.length,
};

export const FIXTURE_NARRATIVE_EVIDENCE: Record<string, EvidenceChainResponse> =
  {
    [NARRATIVE_A.narrative_id]: {
      narrative_id: NARRATIVE_A.narrative_id,
      evidence: [
        {
          chunk_id: "chunk_fixture_001",
          source_document_id: "doc_fixture_ticket_1001",
          source_uri: "lorevault://documents/doc_fixture_ticket_1001#chunk_001",
          raw_text:
            "Customer reported repeated login failures on the Aura portal after the v3.4 release.",
          signal_id: "sig_fixture_retention_001",
          signal_raw_score: 72,
          signal_polarity: "concern",
          chunk_score: 0.84,
          status: "live",
          extracted_at: FIXTURE_TIMESTAMP,
        },
        {
          chunk_id: "chunk_fixture_002",
          source_document_id: "doc_fixture_ticket_1002",
          raw_text:
            "Second user on the same tenant hit the same MFA loop within 36 hours.",
          signal_id: "sig_fixture_first_response_breach_002",
          signal_raw_score: 58,
          signal_polarity: "concern",
          chunk_score: 0.71,
          status: "live",
          extracted_at: FIXTURE_TIMESTAMP,
        },
      ],
    },
    [NARRATIVE_B.narrative_id]: {
      narrative_id: NARRATIVE_B.narrative_id,
      evidence: [
        {
          chunk_id: "chunk_fixture_003",
          source_document_id: "doc_fixture_deal_7001",
          raw_text:
            "Deal stalled in 'Decision-Maker Engaged' for 41 days; expected median is 12 days.",
          signal_id: "sig_fixture_deal_slippage_003",
          signal_raw_score: 64,
          signal_polarity: "concern",
          chunk_score: 0.77,
          status: "live",
          extracted_at: FIXTURE_TIMESTAMP,
        },
      ],
    },
  };

export const FIXTURE_SIGNAL_EVIDENCE: Record<string, SignalEvidenceResponse> = {
  sig_fixture_retention_001: {
    signal_id: "sig_fixture_retention_001",
    evidence: FIXTURE_NARRATIVE_EVIDENCE[
      NARRATIVE_A.narrative_id
    ].evidence.filter((e) => e.signal_id === "sig_fixture_retention_001"),
  },
  sig_fixture_deal_slippage_003: {
    signal_id: "sig_fixture_deal_slippage_003",
    evidence: FIXTURE_NARRATIVE_EVIDENCE[
      NARRATIVE_B.narrative_id
    ].evidence.filter((e) => e.signal_id === "sig_fixture_deal_slippage_003"),
  },
};

// ---------------------------------------------------------------------------
// Query (signal-aware retrieval)
// ---------------------------------------------------------------------------

export const FIXTURE_QUERY_RESPONSE: QueryResponse = {
  knowledge_space_id: FIXTURE_KS_ID,
  evidence: [
    {
      chunk_id: "chunk_fixture_001",
      source_document_id: "doc_fixture_ticket_1001",
      raw_text:
        "Customer reported repeated login failures on the Aura portal after the v3.4 release.",
      signal_id: "sig_fixture_retention_001",
      raw_score: 72,
      polarity: "concern",
      lens: "customer_interaction",
      extracted_at: FIXTURE_TIMESTAMP,
    },
  ],
  group_by: "signal",
  groups: [
    {
      key: "sig_fixture_retention_001",
      chunk_ids: ["chunk_fixture_001"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const FIXTURE_HEALTH: HealthResponse = {
  status: "ok",
  version: "phase0-mock",
  checked_at: FIXTURE_TIMESTAMP,
};
