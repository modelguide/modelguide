/**
 * HubSpot response shapes — allowlists of fields to keep per entity.
 *
 * Applied automatically by the connector dispatcher via `trimToShape()`,
 * so handlers can return the raw HubSpot envelope without leaking noise.
 *
 * Reference: HubSpot Connector Spec §6.
 */

import type { ResponseShape } from "../lib/response-trimmer";

// ---------------------------------------------------------------------------
// Common HubSpot object envelope
// ---------------------------------------------------------------------------

const HUBSPOT_OBJECT_BASE: ResponseShape = {
  id: true,
  properties: true,
  createdAt: true,
  updatedAt: true,
  archived: true,
};

// ---------------------------------------------------------------------------
// Contact / Company / Deal / Ticket / Engagement
// ---------------------------------------------------------------------------

export const CONTACT: ResponseShape = { ...HUBSPOT_OBJECT_BASE };
export const COMPANY: ResponseShape = { ...HUBSPOT_OBJECT_BASE };
export const DEAL: ResponseShape = { ...HUBSPOT_OBJECT_BASE };
export const TICKET: ResponseShape = { ...HUBSPOT_OBJECT_BASE };
export const ENGAGEMENT: ResponseShape = { ...HUBSPOT_OBJECT_BASE };

// ---------------------------------------------------------------------------
// Conversation thread message (reply)
// ---------------------------------------------------------------------------

export const CONVERSATION_MESSAGE: ResponseShape = {
  id: true,
  type: true,
  channelId: true,
  channelAccountId: true,
  createdAt: true,
  createdBy: true,
  status: true,
  direction: true,
  recipients: true,
  senders: true,
  subject: true,
  text: true,
  richText: true,
};

// ---------------------------------------------------------------------------
// Search/list envelopes — keep totals + array slot
// ---------------------------------------------------------------------------

export const CONTACT_LIST: ResponseShape = {
  results: CONTACT,
  total: true,
  paging: true,
};

export const COMPANY_LIST: ResponseShape = {
  results: COMPANY,
  total: true,
  paging: true,
};

export const DEAL_LIST: ResponseShape = {
  results: DEAL,
  total: true,
  paging: true,
};

export const TICKET_LIST: ResponseShape = {
  results: TICKET,
  total: true,
  paging: true,
};
