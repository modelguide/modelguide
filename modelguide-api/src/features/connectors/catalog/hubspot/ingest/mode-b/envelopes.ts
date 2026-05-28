/**
 * Signal envelope builders for the HubSpot connector's signal-emitting tools.
 *
 * Spec mapping (HubSpot Connector Spec §5):
 *
 *   tool                  | event_type         | entity.type | declared_lens_hints
 *   --------------------- | ------------------ | ----------- | -----------------------------------------------
 *   Create Contact        | contact.created    | contact     | customer_interaction
 *   Update Contact        | contact.updated    | contact     | customer_interaction (+ revenue_intelligence
 *                                                              when properties_changed includes lifecyclestage)
 *   Create Deal           | deal.created       | deal        | revenue_intelligence
 *   Update Deal Stage     | deal.stage_changed | deal        | revenue_intelligence, operational_workflow
 *   Create Ticket         | ticket.created     | ticket      | customer_interaction, operational_workflow
 *   Update Ticket         | ticket.updated     | ticket      | operational_workflow
 *   Close Ticket          | ticket.closed      | ticket      | operational_workflow, customer_interaction
 *   Add Reply To Ticket   | ticket.reply_sent  | ticket      | customer_interaction, knowledge_integrity
 *   Log Call Engagement   | call.logged        | engagement  | customer_interaction, operational_workflow
 *   Create Note           | note.created       | note        | knowledge_integrity, operational_workflow
 *
 * (Spec §5's summary line says "12 signal-emitting" but the per-row table
 * enumerates exactly 10. We implement what the row-level table specifies —
 * the source of truth for behavior — and surface the count discrepancy in
 * the Phase 2 PR description.)
 *
 * Envelope shape: Phase 0 Integration Contract §1.1. canonical_object_identity
 * is derived deterministically from `deriveSourceId`.
 */

import type {
  LensId,
  SignalEvent,
  SignalPayload,
} from "../../../../../lorevault/client";
import type { ToolExecutionContext } from "../../../types";
import { type HubSpotObjectType, deriveSourceId } from "../canonical-identity";

// ---------------------------------------------------------------------------
// Tool name → event type lookup. Names match the manifest `catalog.name`.
// ---------------------------------------------------------------------------

export const EMITTING_TOOL_EVENT_TYPES = {
  "Create Contact": "contact.created",
  "Update Contact": "contact.updated",
  "Create Deal": "deal.created",
  "Update Deal Stage": "deal.stage_changed",
  "Create Ticket": "ticket.created",
  "Update Ticket": "ticket.updated",
  "Close Ticket": "ticket.closed",
  "Add Reply To Ticket": "ticket.reply_sent",
  "Log Call Engagement": "call.logged",
  "Create Note": "note.created",
} as const;

export type EmittingToolName = keyof typeof EMITTING_TOOL_EVENT_TYPES;
export type SignalEventType =
  (typeof EMITTING_TOOL_EVENT_TYPES)[EmittingToolName];

// ---------------------------------------------------------------------------
// Builder input
// ---------------------------------------------------------------------------

export interface EmissionConfig {
  knowledgeSpaceId: string;
  vaultId: string;
  sourceInstance: string;
}

export interface EnvelopeBuildInput {
  ctx: ToolExecutionContext;
  /** HubSpot envelope returned by the tool handler. */
  result: Record<string, unknown> | undefined;
  config: EmissionConfig;
  /** Injectable for tests; defaults to crypto.randomUUID() + Date.now(). */
  signalId?: string;
  emittedAt?: string;
}

interface InternalEntity {
  type: HubSpotObjectType;
  id: string;
  portalUrl?: string;
}

// ---------------------------------------------------------------------------
// Per-tool builders
// ---------------------------------------------------------------------------

type Builder = (input: EnvelopeBuildInput) => SignalEvent | null;

const builders: Record<EmittingToolName, Builder> = {
  "Create Contact": (i) =>
    buildEnvelope(i, {
      eventType: "contact.created",
      entityFrom: { type: "contact", source: "result" },
      lensHints: ["customer_interaction"],
      payload: (i) => ({ snapshot: extractProperties(i.result) }),
    }),

  "Update Contact": (i) => {
    const inputProps = readInputProperties(i.ctx);
    const propertiesChanged = Object.keys(inputProps);
    const lensHints: LensId[] = ["customer_interaction"];
    if ("lifecyclestage" in inputProps) lensHints.push("revenue_intelligence");
    return buildEnvelope(i, {
      eventType: "contact.updated",
      entityFrom: { type: "contact", source: "input", inputField: "contactId" },
      lensHints,
      payload: () => ({
        after: extractProperties(i.result),
        properties_changed: propertiesChanged,
      }),
    });
  },

  "Create Deal": (i) =>
    buildEnvelope(i, {
      eventType: "deal.created",
      entityFrom: { type: "deal", source: "result" },
      lensHints: ["revenue_intelligence"],
      payload: () => ({ snapshot: extractProperties(i.result) }),
    }),

  "Update Deal Stage": (i) => {
    const stage = readInputField(i.ctx, "stage") as string | undefined;
    return buildEnvelope(i, {
      eventType: "deal.stage_changed",
      entityFrom: { type: "deal", source: "input", inputField: "dealId" },
      lensHints: ["revenue_intelligence", "operational_workflow"],
      payload: () => ({
        after: { dealstage: stage },
        properties_changed: ["dealstage"],
      }),
    });
  },

  "Create Ticket": (i) =>
    buildEnvelope(i, {
      eventType: "ticket.created",
      entityFrom: { type: "ticket", source: "result" },
      lensHints: ["customer_interaction", "operational_workflow"],
      payload: () => ({ snapshot: extractProperties(i.result) }),
    }),

  "Update Ticket": (i) => {
    const inputProps = readInputProperties(i.ctx);
    return buildEnvelope(i, {
      eventType: "ticket.updated",
      entityFrom: { type: "ticket", source: "input", inputField: "ticketId" },
      lensHints: ["operational_workflow"],
      payload: () => ({
        after: extractProperties(i.result),
        properties_changed: Object.keys(inputProps),
      }),
    });
  },

  "Close Ticket": (i) =>
    buildEnvelope(i, {
      eventType: "ticket.closed",
      entityFrom: { type: "ticket", source: "input", inputField: "ticketId" },
      lensHints: ["operational_workflow", "customer_interaction"],
      payload: () => ({
        after: extractProperties(i.result),
        properties_changed: ["hs_pipeline_stage"],
      }),
    }),

  "Add Reply To Ticket": (i) => {
    const text =
      (readInputField(i.ctx, "text") as string | undefined) ??
      (readInputField(i.ctx, "richText") as string | undefined);
    return buildEnvelope(i, {
      eventType: "ticket.reply_sent",
      entityFrom: { type: "ticket", source: "input", inputField: "ticketId" },
      lensHints: ["customer_interaction", "knowledge_integrity"],
      payload: () => ({ text }),
    });
  },

  "Log Call Engagement": (i) =>
    buildEnvelope(i, {
      eventType: "call.logged",
      entityFrom: { type: "engagement", source: "result" },
      lensHints: ["customer_interaction", "operational_workflow"],
      payload: () => ({ snapshot: extractProperties(i.result) }),
    }),

  "Create Note": (i) =>
    buildEnvelope(i, {
      eventType: "note.created",
      entityFrom: { type: "note", source: "result" },
      lensHints: ["knowledge_integrity", "operational_workflow"],
      payload: () => ({ snapshot: extractProperties(i.result) }),
    }),
};

export function buildEnvelopeForTool(
  toolName: EmittingToolName,
  input: EnvelopeBuildInput,
): SignalEvent | null {
  const fn = builders[toolName];
  return fn ? fn(input) : null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface BuildSpec {
  eventType: SignalEventType;
  entityFrom:
    | { type: HubSpotObjectType; source: "result" }
    | { type: HubSpotObjectType; source: "input"; inputField: string };
  lensHints: LensId[];
  payload: (input: EnvelopeBuildInput) => SignalPayload;
}

function buildEnvelope(
  input: EnvelopeBuildInput,
  spec: BuildSpec,
): SignalEvent | null {
  const entity = resolveEntity(input, spec.entityFrom);
  if (!entity) return null;

  const portalUrl =
    entity.portalUrl ?? buildPortalUrl(input.ctx, entity.type, entity.id);

  return {
    signal_id: input.signalId ?? crypto.randomUUID(),
    signal_version: "1",
    emitted_at: input.emittedAt ?? new Date().toISOString(),
    source_system: "hubspot",
    source_instance: input.config.sourceInstance,
    knowledge_space_id: input.config.knowledgeSpaceId,
    vault_id: input.config.vaultId,
    event_type: spec.eventType,
    entity: {
      type: entity.type,
      id: entity.id,
      ...(portalUrl ? { portal_url: portalUrl } : {}),
    },
    actor: resolveActor(input.ctx),
    declared_lens_hints: spec.lensHints,
    canonical_object_identity: {
      tenant_id: input.config.vaultId,
      source_system: "hubspot",
      object_type: entity.type,
      object_id: entity.id,
    },
    payload: spec.payload(input),
  };
}

function resolveEntity(
  input: EnvelopeBuildInput,
  spec: BuildSpec["entityFrom"],
): InternalEntity | null {
  if (spec.source === "result") {
    const id =
      typeof input.result?.id === "string"
        ? input.result.id
        : input.result?.id != null
          ? String(input.result.id)
          : undefined;
    if (!id) return null;
    return { type: spec.type, id };
  }
  const id = readInputField(input.ctx, spec.inputField) as string | undefined;
  if (!id) return null;
  return { type: spec.type, id };
}

function resolveActor(ctx: ToolExecutionContext): SignalEvent["actor"] {
  // Mode B fires only on agent-originated tool calls (spec §2).
  // We have no per-call agent identity in the current context, so we
  // attribute to the connector instance. The agentic-layer dispatch (Phase 3)
  // can thread the real agent_id through here without changing the envelope.
  return {
    type: "ai_agent",
    id: ctx.connectorId,
    name: ctx.organizationId,
  };
}

function buildPortalUrl(
  ctx: ToolExecutionContext,
  objectType: HubSpotObjectType,
  id: string,
): string | undefined {
  const portalId = ctx.config.portalId?.trim();
  if (!portalId) return undefined;
  const path = OBJECT_TYPE_TO_URL_PATH[objectType];
  if (!path) return undefined;
  return `https://app.hubspot.com/${path}/${portalId}/${encodeURIComponent(id)}`;
}

const OBJECT_TYPE_TO_URL_PATH: Partial<Record<HubSpotObjectType, string>> = {
  contact: "contacts",
  company: "company",
  deal: "deal",
  ticket: "tickets",
};

function readInputProperties(
  ctx: ToolExecutionContext,
): Record<string, unknown> {
  const props = (ctx.input as { properties?: unknown }).properties;
  if (!props || typeof props !== "object") return {};
  return props as Record<string, unknown>;
}

function readInputField(ctx: ToolExecutionContext, field: string): unknown {
  return (ctx.input as Record<string, unknown>)[field];
}

function extractProperties(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!result) return undefined;
  const props = (result as { properties?: unknown }).properties;
  if (props && typeof props === "object")
    return props as Record<string, unknown>;
  return undefined;
}

// ---------------------------------------------------------------------------
// Re-export the canonical identity helper to make the envelope→source_id
// mapping obvious at the call site (audit + dashboard cross-link).
// ---------------------------------------------------------------------------

export function deriveSignalSourceId(envelope: SignalEvent): string {
  return deriveSourceId({
    tenantId: envelope.canonical_object_identity.tenant_id,
    objectType: envelope.canonical_object_identity
      .object_type as HubSpotObjectType,
    objectId: envelope.canonical_object_identity.object_id,
  });
}
