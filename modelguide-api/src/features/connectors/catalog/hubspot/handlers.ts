/**
 * HubSpot connector handlers.
 *
 * 19 MCP-exposed tools grouped by entity:
 *   Contacts (5), Companies (2), Deals (3), Tickets (7), Engagements (2)
 *
 * Plus 2 internal-only KB ingest operations (NOT MCP-registered):
 *   listKnowledgeArticles, getKnowledgeArticle
 *
 * Governance rules enforced here (per spec §6):
 *   - Property allowlist on Update Contact and Update Ticket.
 *   - Close Ticket resolves the per-pipeline CLOSED stage at handler entry.
 *   - Update Ticket rejects any pipeline-stage that resolves to a closed stage.
 *   - Add Reply To Ticket writes via Conversations API, channel inferred from
 *     the existing thread; errors clearly when no thread exists.
 */

import { withConnector } from "../lib/http-client";
import { runHealthCheck } from "../lib/run-health-check";
import type { HealthCheckResult, ToolExecutionResult } from "../types";
import { type HubSpotFetcher, createHubSpotFetcher } from "./client";

// ---------------------------------------------------------------------------
// Property allowlists (spec §6)
// ---------------------------------------------------------------------------

export const UPDATE_CONTACT_ALLOWED_PROPERTIES: ReadonlySet<string> = new Set([
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "company",
  "jobtitle",
  "lifecyclestage",
  "hs_lead_status",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "website",
]);

export const UPDATE_TICKET_ALLOWED_PROPERTIES: ReadonlySet<string> = new Set([
  "subject",
  "content",
  "hs_ticket_priority",
  "hs_ticket_category",
  "hubspot_owner_id",
  "hs_pipeline",
  "hs_pipeline_stage",
]);

function rejectNonAllowlisted(
  properties: Record<string, unknown>,
  allowlist: ReadonlySet<string>,
  toolName: string,
): { error: string } | null {
  const offending = Object.keys(properties).filter((k) => !allowlist.has(k));
  if (offending.length === 0) return null;
  return {
    error: `${toolName} rejected non-allowlisted properties: ${offending.join(
      ", ",
    )}. Allowed: ${[...allowlist].sort().join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Pipeline / stage helpers
// ---------------------------------------------------------------------------

interface PipelineStage {
  id: string;
  label: string;
  metadata?: { ticketState?: string };
}

interface Pipeline {
  id: string;
  label: string;
  stages: PipelineStage[];
}

async function fetchTicketPipeline(
  fetcher: HubSpotFetcher,
  pipelineId: string,
): Promise<Pipeline> {
  return await fetcher<Pipeline>(
    `/crm/v3/pipelines/tickets/${encodeURIComponent(pipelineId)}`,
  );
}

function isClosedStage(stage: PipelineStage): boolean {
  return stage.metadata?.ticketState === "CLOSED";
}

async function resolveClosedStageId(
  fetcher: HubSpotFetcher,
  pipelineId: string,
): Promise<{ stageId: string } | { error: string }> {
  const pipeline = await fetchTicketPipeline(fetcher, pipelineId);
  const closed = pipeline.stages.find(isClosedStage);
  if (!closed) {
    return {
      error: `Pipeline ${pipelineId} (${pipeline.label}) has no stage with metadata.ticketState === "CLOSED". Configure a closed stage in HubSpot, then retry.`,
    };
  }
  return { stageId: closed.id };
}

// ---------------------------------------------------------------------------
// Deep-link helper
// ---------------------------------------------------------------------------

function objectUrl(
  config: Record<string, string>,
  objectPath: string,
  id: string,
): string | undefined {
  const portalId = config.portalId?.trim();
  if (!portalId) return undefined;
  return `https://app.hubspot.com/${objectPath}/${portalId}/${encodeURIComponent(
    id,
  )}`;
}

// ---------------------------------------------------------------------------
// HTTP wrapper bound to HubSpot config
// ---------------------------------------------------------------------------

const withHubSpot = withConnector((config) => createHubSpotFetcher(config));

// ---------------------------------------------------------------------------
// Contacts (5)
// ---------------------------------------------------------------------------

export const getContactByEmail = withHubSpot(async (fetcher, ctx) => {
  const { email, properties } = ctx.input as {
    email: string;
    properties?: string[];
  };
  if (!email) return { success: false, error: "email is required" };

  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/contacts/${encodeURIComponent(email)}`,
    {
      params: {
        idProperty: "email",
        properties: properties?.join(","),
      },
    },
  );
  const id = (data as { id?: string }).id;
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "contacts", id ?? email),
  );
});

export const getContactByPhone = withHubSpot(async (fetcher, ctx) => {
  const { phone, properties } = ctx.input as {
    phone: string;
    properties?: string[];
  };
  if (!phone) return { success: false, error: "phone is required" };

  const data = await fetcher<{ results?: { id: string }[] }>(
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: {
        filterGroups: [
          {
            filters: [{ propertyName: "phone", operator: "EQ", value: phone }],
          },
          {
            filters: [
              { propertyName: "mobilephone", operator: "EQ", value: phone },
            ],
          },
        ],
        properties: properties ?? defaultContactProperties(),
        limit: 5,
      },
    },
  );

  const first = data.results?.[0];
  return withMaybeUrl(
    { success: true, data: data as Record<string, unknown> },
    first ? objectUrl(ctx.config, "contacts", first.id) : undefined,
  );
});

export const searchContacts = withHubSpot(async (fetcher, ctx) => {
  const input = ctx.input as {
    query?: string;
    filters?: HubSpotSearchFilter[];
    properties?: string[];
    limit?: number;
    after?: string;
  };

  const body: Record<string, unknown> = {
    properties: input.properties ?? defaultContactProperties(),
    limit: Math.min(input.limit ?? 25, 100),
  };
  if (input.query) body.query = input.query;
  if (input.filters?.length) {
    body.filterGroups = [{ filters: input.filters }];
  }
  if (input.after) body.after = input.after;

  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/contacts/search",
    { method: "POST", body },
  );
  return { success: true, data };
});

export const createContact = withHubSpot(async (fetcher, ctx) => {
  const { properties } = ctx.input as { properties: Record<string, unknown> };
  if (!properties || typeof properties !== "object") {
    return { success: false, error: "properties object is required" };
  }
  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/contacts",
    { method: "POST", body: { properties } },
  );
  const id = (data as { id?: string }).id;
  return withMaybeUrl(
    { success: true, data },
    id ? objectUrl(ctx.config, "contacts", id) : undefined,
  );
});

export const updateContact = withHubSpot(async (fetcher, ctx) => {
  const { contactId, properties } = ctx.input as {
    contactId: string;
    properties: Record<string, unknown>;
  };
  if (!contactId) return { success: false, error: "contactId is required" };
  if (!properties || typeof properties !== "object") {
    return { success: false, error: "properties object is required" };
  }

  const rejected = rejectNonAllowlisted(
    properties,
    UPDATE_CONTACT_ALLOWED_PROPERTIES,
    "Update Contact",
  );
  if (rejected) return { success: false, error: rejected.error };

  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
    { method: "PATCH", body: { properties } },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "contacts", contactId),
  );
});

// ---------------------------------------------------------------------------
// Companies (2)
// ---------------------------------------------------------------------------

export const getCompany = withHubSpot(async (fetcher, ctx) => {
  const { companyId, properties } = ctx.input as {
    companyId: string;
    properties?: string[];
  };
  if (!companyId) return { success: false, error: "companyId is required" };
  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/companies/${encodeURIComponent(companyId)}`,
    { params: { properties: properties?.join(",") } },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "company", companyId),
  );
});

export const listCompaniesForContact = withHubSpot(async (fetcher, ctx) => {
  const { contactId } = ctx.input as { contactId: string };
  if (!contactId) return { success: false, error: "contactId is required" };

  const assoc = await fetcher<{
    results?: { toObjectId: string | number; id?: string }[];
  }>(
    `/crm/v3/objects/contacts/${encodeURIComponent(
      contactId,
    )}/associations/companies`,
  );
  const ids = (assoc.results ?? []).map((r) =>
    String((r as { toObjectId?: string | number }).toObjectId ?? r.id ?? ""),
  );
  if (ids.length === 0) {
    return { success: true, data: { results: [], total: 0 } };
  }

  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/companies/batch/read",
    {
      method: "POST",
      body: {
        properties: defaultCompanyProperties(),
        inputs: ids.map((id) => ({ id })),
      },
    },
  );
  return { success: true, data };
});

// ---------------------------------------------------------------------------
// Deals (3)
// ---------------------------------------------------------------------------

export const listDealsForContact = withHubSpot(async (fetcher, ctx) => {
  const { contactId } = ctx.input as { contactId: string };
  if (!contactId) return { success: false, error: "contactId is required" };

  const assoc = await fetcher<{
    results?: { toObjectId: string | number; id?: string }[];
  }>(
    `/crm/v3/objects/contacts/${encodeURIComponent(
      contactId,
    )}/associations/deals`,
  );
  const ids = (assoc.results ?? []).map((r) =>
    String((r as { toObjectId?: string | number }).toObjectId ?? r.id ?? ""),
  );
  if (ids.length === 0) {
    return { success: true, data: { results: [], total: 0 } };
  }

  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/deals/batch/read",
    {
      method: "POST",
      body: {
        properties: defaultDealProperties(),
        inputs: ids.map((id) => ({ id })),
      },
    },
  );
  return { success: true, data };
});

export const createDeal = withHubSpot(async (fetcher, ctx) => {
  const input = ctx.input as {
    properties: Record<string, unknown>;
    associations?: HubSpotAssociation[];
  };
  if (!input.properties || typeof input.properties !== "object") {
    return { success: false, error: "properties object is required" };
  }

  const properties = { ...input.properties };
  if (!properties.pipeline && ctx.config.defaultPipelineId) {
    properties.pipeline = ctx.config.defaultPipelineId;
  }

  const body: Record<string, unknown> = { properties };
  if (input.associations?.length) body.associations = input.associations;

  const data = await fetcher<Record<string, unknown>>("/crm/v3/objects/deals", {
    method: "POST",
    body,
  });
  const id = (data as { id?: string }).id;
  return withMaybeUrl(
    { success: true, data },
    id ? objectUrl(ctx.config, "deal", id) : undefined,
  );
});

export const updateDealStage = withHubSpot(async (fetcher, ctx) => {
  const { dealId, stage } = ctx.input as {
    dealId: string;
    stage: string;
  };
  if (!dealId) return { success: false, error: "dealId is required" };
  if (!stage) return { success: false, error: "stage is required" };

  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
    { method: "PATCH", body: { properties: { dealstage: stage } } },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "deal", dealId),
  );
});

// ---------------------------------------------------------------------------
// Tickets (7)
// ---------------------------------------------------------------------------

export const getTicket = withHubSpot(async (fetcher, ctx) => {
  const { ticketId, properties } = ctx.input as {
    ticketId: string;
    properties?: string[];
  };
  if (!ticketId) return { success: false, error: "ticketId is required" };
  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}`,
    {
      params: {
        properties: (properties ?? defaultTicketProperties()).join(","),
      },
    },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "tickets", ticketId),
  );
});

export const listTicketsForContact = withHubSpot(async (fetcher, ctx) => {
  const { contactId } = ctx.input as { contactId: string };
  if (!contactId) return { success: false, error: "contactId is required" };

  const assoc = await fetcher<{
    results?: { toObjectId: string | number; id?: string }[];
  }>(
    `/crm/v3/objects/contacts/${encodeURIComponent(
      contactId,
    )}/associations/tickets`,
  );
  const ids = (assoc.results ?? []).map((r) =>
    String((r as { toObjectId?: string | number }).toObjectId ?? r.id ?? ""),
  );
  if (ids.length === 0) {
    return { success: true, data: { results: [], total: 0 } };
  }

  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/tickets/batch/read",
    {
      method: "POST",
      body: {
        properties: defaultTicketProperties(),
        inputs: ids.map((id) => ({ id })),
      },
    },
  );
  return { success: true, data };
});

export const searchTickets = withHubSpot(async (fetcher, ctx) => {
  const input = ctx.input as {
    query?: string;
    filters?: HubSpotSearchFilter[];
    properties?: string[];
    limit?: number;
    after?: string;
    sortBy?: string;
    sortDirection?: "ASCENDING" | "DESCENDING";
  };

  const body: Record<string, unknown> = {
    properties: input.properties ?? defaultTicketProperties(),
    limit: Math.min(input.limit ?? 25, 100),
  };
  if (input.query) body.query = input.query;
  if (input.filters?.length) {
    body.filterGroups = [{ filters: input.filters }];
  }
  if (input.after) body.after = input.after;
  if (input.sortBy) {
    body.sorts = [
      {
        propertyName: input.sortBy,
        direction: input.sortDirection ?? "DESCENDING",
      },
    ];
  }

  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/tickets/search",
    { method: "POST", body },
  );
  return { success: true, data };
});

export const createTicket = withHubSpot(async (fetcher, ctx) => {
  const input = ctx.input as {
    properties: Record<string, unknown>;
    associations?: HubSpotAssociation[];
  };
  if (!input.properties || typeof input.properties !== "object") {
    return { success: false, error: "properties object is required" };
  }

  const properties = { ...input.properties };
  if (!properties.hs_pipeline && ctx.config.defaultTicketPipelineId) {
    properties.hs_pipeline = ctx.config.defaultTicketPipelineId;
  }

  const body: Record<string, unknown> = { properties };
  if (input.associations?.length) body.associations = input.associations;

  const data = await fetcher<Record<string, unknown>>(
    "/crm/v3/objects/tickets",
    { method: "POST", body },
  );
  const id = (data as { id?: string }).id;
  return withMaybeUrl(
    { success: true, data },
    id ? objectUrl(ctx.config, "tickets", id) : undefined,
  );
});

export const updateTicket = withHubSpot(async (fetcher, ctx) => {
  const { ticketId, properties } = ctx.input as {
    ticketId: string;
    properties: Record<string, unknown>;
  };
  if (!ticketId) return { success: false, error: "ticketId is required" };
  if (!properties || typeof properties !== "object") {
    return { success: false, error: "properties object is required" };
  }

  const rejected = rejectNonAllowlisted(
    properties,
    UPDATE_TICKET_ALLOWED_PROPERTIES,
    "Update Ticket",
  );
  if (rejected) return { success: false, error: rejected.error };

  // Reject any pipeline-stage that resolves to a closed stage (spec §6).
  const proposedStage = properties.hs_pipeline_stage;
  if (typeof proposedStage === "string" && proposedStage.length > 0) {
    const pipelineId =
      typeof properties.hs_pipeline === "string" && properties.hs_pipeline
        ? properties.hs_pipeline
        : await resolveTicketPipelineId(fetcher, ticketId);
    if (!pipelineId) {
      return {
        success: false,
        error:
          "Update Ticket cannot validate hs_pipeline_stage: ticket has no resolvable pipeline. Include hs_pipeline in the update, or use Close Ticket.",
      };
    }
    const pipeline = await fetchTicketPipeline(fetcher, pipelineId);
    const stage = pipeline.stages.find((s) => s.id === proposedStage);
    if (!stage) {
      return {
        success: false,
        error: `Update Ticket: hs_pipeline_stage "${proposedStage}" is not a valid stage of pipeline ${pipelineId}.`,
      };
    }
    if (isClosedStage(stage)) {
      return {
        success: false,
        error: `Update Ticket cannot move a ticket to closed stage "${stage.label}" (${stage.id}). Use Close Ticket instead.`,
      };
    }
  }

  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}`,
    { method: "PATCH", body: { properties } },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "tickets", ticketId),
  );
});

export const closeTicket = withHubSpot(async (fetcher, ctx) => {
  const { ticketId, closeNote } = ctx.input as {
    ticketId: string;
    closeNote?: string;
  };
  if (!ticketId) return { success: false, error: "ticketId is required" };

  const pipelineId = await resolveTicketPipelineId(fetcher, ticketId);
  if (!pipelineId) {
    return {
      success: false,
      error: `Close Ticket cannot resolve pipeline for ticket ${ticketId}. Verify the ticket exists and has hs_pipeline set.`,
    };
  }
  const resolved = await resolveClosedStageId(fetcher, pipelineId);
  if ("error" in resolved) return { success: false, error: resolved.error };

  const data = await fetcher<Record<string, unknown>>(
    `/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}`,
    {
      method: "PATCH",
      body: {
        properties: {
          hs_pipeline: pipelineId,
          hs_pipeline_stage: resolved.stageId,
          ...(closeNote ? { closed_note: closeNote } : {}),
        },
      },
    },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "tickets", ticketId),
  );
});

interface ConversationThread {
  id: string;
  latestMessageReceivedTimestamp?: string;
  channelId?: string;
  channelAccountId?: string;
  associatedContactId?: string;
  inboxId?: string;
  status?: string;
}

interface ConversationMessage {
  id: string;
  type: string;
  channelId?: string;
  channelAccountId?: string;
  recipients?: Array<Record<string, unknown>>;
  senders?: Array<Record<string, unknown>>;
  subject?: string;
  direction?: string;
  text?: string;
  richText?: string;
}

async function getPrimaryTicketThread(
  fetcher: HubSpotFetcher,
  ticketId: string,
): Promise<{ thread: ConversationThread } | { error: string }> {
  // Preferred path: read the ticket's hs_thread_ids property (semicolon-separated).
  const ticket = await fetcher<{
    properties?: { hs_thread_ids?: string };
  }>(`/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}`, {
    params: { properties: "hs_thread_ids" },
  });

  const raw = ticket.properties?.hs_thread_ids?.trim();
  let threadIds: string[] = [];
  if (raw) {
    threadIds = raw.split(/[;,\s]+/).filter(Boolean);
  } else {
    // Fallback: associations API.
    const assoc = await fetcher<{
      results?: { toObjectId?: string | number; id?: string }[];
    }>(
      `/crm/v3/objects/tickets/${encodeURIComponent(
        ticketId,
      )}/associations/conversation`,
    );
    threadIds = (assoc.results ?? [])
      .map((r) => String(r.toObjectId ?? r.id ?? ""))
      .filter(Boolean);
  }

  if (threadIds.length === 0) {
    return {
      error: `Add Reply To Ticket: ticket ${ticketId} has no associated conversation thread. Replies require an existing thread (the ticket must have been opened via a conversations channel: email, chat, etc.).`,
    };
  }

  // Pick the most recent thread by latestMessageReceivedTimestamp.
  const threads = await Promise.all(
    threadIds.map((id) =>
      fetcher<ConversationThread>(
        `/conversations/v3/conversations/threads/${encodeURIComponent(id)}`,
      ),
    ),
  );
  const sorted = threads
    .filter((t) => !!t.id)
    .sort((a, b) =>
      (b.latestMessageReceivedTimestamp ?? "").localeCompare(
        a.latestMessageReceivedTimestamp ?? "",
      ),
    );

  if (sorted.length === 0) {
    return {
      error: `Add Reply To Ticket: ticket ${ticketId} references thread IDs but none resolved via the Conversations API.`,
    };
  }
  return { thread: sorted[0] };
}

export const addReplyToTicket = withHubSpot(async (fetcher, ctx) => {
  const { ticketId, text, richText, internal } = ctx.input as {
    ticketId: string;
    text?: string;
    richText?: string;
    internal?: boolean;
  };
  if (!ticketId) return { success: false, error: "ticketId is required" };
  if (!text && !richText) {
    return { success: false, error: "Either text or richText is required" };
  }

  const resolved = await getPrimaryTicketThread(fetcher, ticketId);
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { thread } = resolved;

  // Inspect the most recent inbound message to mirror its channel + recipients.
  const history = await fetcher<{ results?: ConversationMessage[] }>(
    `/conversations/v3/conversations/threads/${encodeURIComponent(
      thread.id,
    )}/messages`,
    { params: { limit: 25 } },
  );
  const latestInbound = (history.results ?? [])
    .filter((m) => m.type === "MESSAGE" && m.direction === "INCOMING")
    .pop();

  const channelId = latestInbound?.channelId ?? thread.channelId;
  const channelAccountId =
    latestInbound?.channelAccountId ?? thread.channelAccountId;
  if (!channelId || !channelAccountId) {
    return {
      success: false,
      error: `Add Reply To Ticket: could not infer channel/channelAccount from thread ${thread.id}. The thread is missing both inbound message history and channel metadata.`,
    };
  }

  const messageBody: Record<string, unknown> = {
    type: internal ? "COMMENT" : "MESSAGE",
    channelId,
    channelAccountId,
    recipients: latestInbound?.senders ?? latestInbound?.recipients ?? [],
    subject: latestInbound?.subject,
    text,
    richText: richText ?? text,
  };

  const data = await fetcher<Record<string, unknown>>(
    `/conversations/v3/conversations/threads/${encodeURIComponent(
      thread.id,
    )}/messages`,
    { method: "POST", body: messageBody },
  );
  return withMaybeUrl(
    { success: true, data },
    objectUrl(ctx.config, "tickets", ticketId),
  );
});

// ---------------------------------------------------------------------------
// Engagements (2)
// ---------------------------------------------------------------------------

export const logCallEngagement = withHubSpot(async (fetcher, ctx) => {
  const input = ctx.input as {
    properties: Record<string, unknown>;
    associations?: HubSpotAssociation[];
  };
  if (!input.properties || typeof input.properties !== "object") {
    return { success: false, error: "properties object is required" };
  }
  const body: Record<string, unknown> = { properties: input.properties };
  if (input.associations?.length) body.associations = input.associations;

  const data = await fetcher<Record<string, unknown>>("/crm/v3/objects/calls", {
    method: "POST",
    body,
  });
  return { success: true, data };
});

export const createNote = withHubSpot(async (fetcher, ctx) => {
  const input = ctx.input as {
    properties: Record<string, unknown>;
    associations?: HubSpotAssociation[];
  };
  if (!input.properties || typeof input.properties !== "object") {
    return { success: false, error: "properties object is required" };
  }
  const body: Record<string, unknown> = { properties: input.properties };
  if (input.associations?.length) body.associations = input.associations;

  const data = await fetcher<Record<string, unknown>>("/crm/v3/objects/notes", {
    method: "POST",
    body,
  });
  return { success: true, data };
});

// ---------------------------------------------------------------------------
// Internal-only KB ingest operations — NOT MCP-registered (spec §5).
// ---------------------------------------------------------------------------

export interface ListKnowledgeArticlesParams {
  limit?: number;
  after?: string;
  state?: "DRAFT" | "PUBLISHED" | "SCHEDULED";
  updatedAfter?: string;
}

export interface HubSpotKnowledgeArticle {
  id: string;
  name?: string;
  htmlTitle?: string;
  language?: string;
  url?: string;
  archived?: boolean;
  state?: string;
  publishDate?: string;
  updatedAt?: string;
  createdAt?: string;
  htmlBody?: string;
  [key: string]: unknown;
}

export interface HubSpotKnowledgeArticleListResponse {
  results: HubSpotKnowledgeArticle[];
  paging?: { next?: { after?: string } };
  total?: number;
}

export async function listKnowledgeArticles(
  config: Record<string, string>,
  params: ListKnowledgeArticlesParams = {},
): Promise<HubSpotKnowledgeArticleListResponse> {
  const fetcher = createHubSpotFetcher(config);
  return await fetcher<HubSpotKnowledgeArticleListResponse>(
    "/cms/v3/knowledge-base/articles",
    {
      params: {
        limit: params.limit ?? 100,
        after: params.after,
        state: params.state,
        updatedAfter: params.updatedAfter,
      },
    },
  );
}

export async function getKnowledgeArticle(
  config: Record<string, string>,
  articleId: string,
): Promise<HubSpotKnowledgeArticle> {
  const fetcher = createHubSpotFetcher(config);
  return await fetcher<HubSpotKnowledgeArticle>(
    `/cms/v3/knowledge-base/articles/${encodeURIComponent(articleId)}`,
  );
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export function healthCheck(
  config: Record<string, string>,
): Promise<HealthCheckResult> {
  return runHealthCheck(async () => {
    const fetcher = createHubSpotFetcher(config, { timeoutMs: 5_000 });
    await fetcher("/crm/v3/objects/contacts", { params: { limit: "1" } });
  });
}

// ---------------------------------------------------------------------------
// Shared types and helpers
// ---------------------------------------------------------------------------

export interface HubSpotSearchFilter {
  propertyName: string;
  operator: string;
  value?: string | number | boolean;
  values?: Array<string | number>;
  highValue?: string | number;
}

export interface HubSpotAssociation {
  to: { id: string };
  types: Array<{ associationCategory: string; associationTypeId: number }>;
}

function withMaybeUrl(
  result: ToolExecutionResult,
  url: string | undefined,
): ToolExecutionResult {
  return url ? { ...result, url } : result;
}

async function resolveTicketPipelineId(
  fetcher: HubSpotFetcher,
  ticketId: string,
): Promise<string | undefined> {
  const ticket = await fetcher<{
    properties?: { hs_pipeline?: string };
  }>(`/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}`, {
    params: { properties: "hs_pipeline" },
  });
  return ticket.properties?.hs_pipeline;
}

function defaultContactProperties(): string[] {
  return [
    "firstname",
    "lastname",
    "email",
    "phone",
    "company",
    "lifecyclestage",
    "hs_lead_status",
    "createdate",
    "lastmodifieddate",
  ];
}

function defaultCompanyProperties(): string[] {
  return [
    "name",
    "domain",
    "industry",
    "lifecyclestage",
    "city",
    "state",
    "country",
    "annualrevenue",
    "numberofemployees",
  ];
}

function defaultDealProperties(): string[] {
  return [
    "dealname",
    "amount",
    "dealstage",
    "pipeline",
    "closedate",
    "hubspot_owner_id",
    "createdate",
  ];
}

function defaultTicketProperties(): string[] {
  return [
    "subject",
    "content",
    "hs_pipeline",
    "hs_pipeline_stage",
    "hs_ticket_priority",
    "hs_ticket_category",
    "hubspot_owner_id",
    "createdate",
    "hs_lastmodifieddate",
    "hs_thread_ids",
  ];
}
