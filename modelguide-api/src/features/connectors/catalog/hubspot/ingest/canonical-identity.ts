/**
 * Canonical identity derivation per Phase 0 Integration Contract §1.2.
 *
 *   source_id = `{tenant_id}:hubspot:{object_type}:{object_id}`
 *
 * `tenant_id` is the LoreVault vault_id. Same canonical identity → same
 * document, idempotent upsert.
 */

export type HubSpotObjectType =
  | "contact"
  | "company"
  | "deal"
  | "ticket"
  | "engagement"
  | "note"
  | "knowledge_article";

export const HUBSPOT_SOURCE_SYSTEM = "hubspot" as const;

export interface CanonicalIdentityInput {
  tenantId: string;
  objectType: HubSpotObjectType;
  objectId: string;
}

export function deriveSourceId(input: CanonicalIdentityInput): string {
  const { tenantId, objectType, objectId } = input;
  if (!tenantId) throw new Error("tenantId is required");
  if (!objectType) throw new Error("objectType is required");
  if (!objectId) throw new Error("objectId is required");
  return `${tenantId}:${HUBSPOT_SOURCE_SYSTEM}:${objectType}:${objectId}`;
}

export const DATASET_IDS: Record<HubSpotObjectType, string> = {
  contact: "hubspot-contacts",
  company: "hubspot-companies",
  deal: "hubspot-deals",
  ticket: "hubspot-tickets",
  engagement: "hubspot-engagements",
  // `note` is an entity type for canonical identity (Mode B emits
  // note.created) but notes are not a separate Mode C corpus surface —
  // they ride along inside ticket/contact documents. Keep the dataset
  // identifier so the source_system→dataset_id mapping is total.
  note: "hubspot-notes",
  knowledge_article: "hubspot-kb",
};
