/**
 * HubSpot → markdown renderers for Mode C corpus ingest.
 *
 *  - `renderTicketAsMarkdown`   one document per ticket, thread inline, properties header
 *  - `renderKnowledgeArticleAsMarkdown`   KB article → markdown
 *  - `renderContactAsMarkdown`   denormalized: contact + company + recent tickets
 *
 * Output shape lines up with `IngestDocument` from the LoreVault contract
 * (Phase 0 §1.2): `{ source_id, title, content, metadata }`.
 */

import type { IngestDocument } from "../../../../lorevault/client";
import type { HubSpotKnowledgeArticle } from "../handlers";
import {
  type CanonicalIdentityInput,
  deriveSourceId,
} from "./canonical-identity";

// ---------------------------------------------------------------------------
// Shared HubSpot CRM object shapes for ingest. Intentionally permissive —
// we render whatever properties HubSpot returns, header-summarized.
// ---------------------------------------------------------------------------

export interface HubSpotObject {
  id: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotConversationMessage {
  id: string;
  type: string;
  direction?: string;
  createdAt?: string;
  senders?: Array<{ name?: string; deliveryIdentifier?: { value?: string } }>;
  recipients?: Array<{
    name?: string;
    deliveryIdentifier?: { value?: string };
  }>;
  text?: string;
  richText?: string;
}

export interface HubSpotTicketWithThread extends HubSpotObject {
  thread?: HubSpotConversationMessage[];
}

export interface HubSpotContactWithContext extends HubSpotObject {
  primaryCompany?: HubSpotObject;
  recentTickets?: HubSpotObject[];
}

interface RenderContext {
  tenantId: string;
  sourceInstance: string;
}

// ---------------------------------------------------------------------------
// Ticket
// ---------------------------------------------------------------------------

export function renderTicketAsMarkdown(
  ticket: HubSpotTicketWithThread,
  ctx: RenderContext,
): IngestDocument {
  const props = ticket.properties ?? {};
  const title = stringify(props.subject) || `HubSpot Ticket #${ticket.id}`;

  const header = renderPropertiesHeader({
    Subject: props.subject,
    Status: props.hs_pipeline_stage,
    Pipeline: props.hs_pipeline,
    Priority: props.hs_ticket_priority,
    Category: props.hs_ticket_category,
    Owner: props.hubspot_owner_id,
    Created: ticket.createdAt ?? props.createdate,
    Updated: ticket.updatedAt ?? props.hs_lastmodifieddate,
    "Source instance": ctx.sourceInstance,
    "Ticket ID": ticket.id,
  });

  const description = stringify(props.content);
  const thread = renderThread(ticket.thread ?? []);

  const content = [
    `# Ticket #${ticket.id} — ${title}`,
    "",
    "## Properties",
    header,
    description ? `\n## Description\n\n${description}` : "",
    thread ? `\n## Conversation thread\n\n${thread}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  return buildDocument(
    {
      tenantId: ctx.tenantId,
      objectType: "ticket",
      objectId: ticket.id,
    },
    {
      title,
      content,
      sourceInstance: ctx.sourceInstance,
      entityType: "ticket",
      entityId: ticket.id,
      createdAt: stringify(ticket.createdAt) || stringify(props.createdate),
      lastModifiedAt:
        stringify(ticket.updatedAt) || stringify(props.hs_lastmodifieddate),
    },
  );
}

function renderThread(messages: HubSpotConversationMessage[]): string {
  if (messages.length === 0) return "";
  const ordered = [...messages].sort((a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
  return ordered
    .map((m) => {
      const who = describeParticipant(m);
      const when = m.createdAt ?? "";
      const body = (m.text ?? stripHtml(m.richText ?? "")).trim();
      return `### ${who} — ${when}\n\n${body || "_(no body)_"}`;
    })
    .join("\n\n");
}

function describeParticipant(m: HubSpotConversationMessage): string {
  const sender = m.senders?.[0];
  const name = sender?.name ?? sender?.deliveryIdentifier?.value ?? "unknown";
  const direction = m.direction ? ` (${m.direction.toLowerCase()})` : "";
  return `${name}${direction}`;
}

// ---------------------------------------------------------------------------
// Knowledge base article
// ---------------------------------------------------------------------------

export function renderKnowledgeArticleAsMarkdown(
  article: HubSpotKnowledgeArticle,
  ctx: RenderContext,
): IngestDocument {
  const title =
    stringify(article.name) ||
    stringify(article.htmlTitle) ||
    `HubSpot KB Article #${article.id}`;
  const body = stripHtml(stringify(article.htmlBody) ?? "");

  const header = renderPropertiesHeader({
    Title: title,
    Language: article.language,
    State: article.state,
    "Published at": article.publishDate,
    "Last updated": article.updatedAt,
    URL: article.url,
    "Source instance": ctx.sourceInstance,
    "Article ID": article.id,
  });

  const content = [
    `# ${title}`,
    "",
    "## Metadata",
    header,
    body ? `\n## Body\n\n${body}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  return buildDocument(
    {
      tenantId: ctx.tenantId,
      objectType: "knowledge_article",
      objectId: article.id,
    },
    {
      title,
      content,
      sourceInstance: ctx.sourceInstance,
      entityType: "knowledge_article",
      entityId: article.id,
      createdAt: stringify(article.createdAt),
      lastModifiedAt: stringify(article.updatedAt),
    },
  );
}

// ---------------------------------------------------------------------------
// Contact (denormalized: company + recent tickets)
// ---------------------------------------------------------------------------

export function renderContactAsMarkdown(
  contact: HubSpotContactWithContext,
  ctx: RenderContext,
): IngestDocument {
  const props = contact.properties ?? {};
  const fullName =
    [stringify(props.firstname), stringify(props.lastname)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    stringify(props.email) ||
    `Contact #${contact.id}`;

  const header = renderPropertiesHeader({
    Name: fullName,
    Email: props.email,
    Phone: props.phone,
    Company: props.company,
    "Lifecycle stage": props.lifecyclestage,
    "Lead status": props.hs_lead_status,
    Owner: props.hubspot_owner_id,
    Created: contact.createdAt ?? props.createdate,
    Updated: contact.updatedAt ?? props.lastmodifieddate,
    "Source instance": ctx.sourceInstance,
    "Contact ID": contact.id,
  });

  const sections: string[] = [`# ${fullName}`, "", "## Profile", header];

  if (contact.primaryCompany) {
    const cp = contact.primaryCompany.properties ?? {};
    sections.push(
      "\n## Primary company",
      renderPropertiesHeader({
        Name: cp.name,
        Domain: cp.domain,
        Industry: cp.industry,
        City: cp.city,
        State: cp.state,
        Country: cp.country,
        "Annual revenue": cp.annualrevenue,
        Employees: cp.numberofemployees,
        "Company ID": contact.primaryCompany.id,
      }),
    );
  }

  if (contact.recentTickets?.length) {
    sections.push("\n## Recent tickets");
    for (const t of contact.recentTickets) {
      const tp = t.properties ?? {};
      sections.push(
        `- **${stringify(tp.subject) || `Ticket #${t.id}`}** — ${
          stringify(tp.hs_pipeline_stage) || "stage unknown"
        }, priority ${stringify(tp.hs_ticket_priority) || "unspecified"} (#${
          t.id
        }, updated ${t.updatedAt ?? tp.hs_lastmodifieddate ?? "unknown"})`,
      );
    }
  }

  const content = sections.join("\n").trim();

  return buildDocument(
    {
      tenantId: ctx.tenantId,
      objectType: "contact",
      objectId: contact.id,
    },
    {
      title: fullName,
      content,
      sourceInstance: ctx.sourceInstance,
      entityType: "contact",
      entityId: contact.id,
      createdAt: stringify(contact.createdAt) || stringify(props.createdate),
      lastModifiedAt:
        stringify(contact.updatedAt) || stringify(props.lastmodifieddate),
    },
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface DocumentFields {
  title: string;
  content: string;
  sourceInstance: string;
  entityType: string;
  entityId: string;
  createdAt?: string;
  lastModifiedAt?: string;
}

function buildDocument(
  identity: CanonicalIdentityInput,
  fields: DocumentFields,
): IngestDocument {
  return {
    source_id: deriveSourceId(identity),
    title: fields.title,
    content: fields.content,
    metadata: {
      source_system: "hubspot",
      source_instance: fields.sourceInstance,
      entity_type: fields.entityType,
      entity_id: fields.entityId,
      created_at: fields.createdAt ?? "",
      last_modified_at: fields.lastModifiedAt ?? "",
    },
  };
}

function renderPropertiesHeader(
  fields: Record<string, string | number | boolean | null | undefined>,
): string {
  const rows = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- **${k}:** ${stringify(v)}`);
  return rows.join("\n");
}

function stringify(
  value: string | number | boolean | null | undefined,
): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
