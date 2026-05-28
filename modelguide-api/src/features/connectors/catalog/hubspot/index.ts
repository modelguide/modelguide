/**
 * HubSpot connector module.
 *
 * Surfaces 19 MCP tools (Contacts 5, Companies 2, Deals 3, Tickets 7,
 * Engagements 2) plus 2 internal-only KB ingest operations (not MCP-exposed —
 * used by the Mode C corpus walker in `./ingest`).
 *
 * Spec: ../../../../../../HubSpot Connector Spec.md (§3, §5, §6).
 */

import type { ConnectorManifest, ConnectorToolDefinition } from "../types";
import {
  addReplyToTicket,
  closeTicket,
  createContact,
  createDeal,
  createNote,
  createTicket,
  getCompany,
  getContactByEmail,
  getContactByPhone,
  getTicket,
  healthCheck,
  listCompaniesForContact,
  listDealsForContact,
  listTicketsForContact,
  logCallEngagement,
  searchContacts,
  searchTickets,
  updateContact,
  updateDealStage,
  updateTicket,
} from "./handlers";
import {
  COMPANY,
  CONTACT,
  CONVERSATION_MESSAGE,
  DEAL,
  ENGAGEMENT,
  TICKET,
} from "./response-shapes";

const FILTER_ITEM_SCHEMA = {
  type: "object",
  properties: {
    propertyName: { type: "string" },
    operator: {
      type: "string",
      description:
        "HubSpot search operator (EQ, NEQ, GT, GTE, LT, LTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN)",
    },
    value: {},
    values: { type: "array" },
    highValue: {},
  },
  required: ["propertyName", "operator"],
} as const;

const ASSOCIATION_ITEM_SCHEMA = {
  type: "object",
  description:
    "HubSpot association — links the new record to another CRM object",
  properties: {
    to: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    types: {
      type: "array",
      items: {
        type: "object",
        properties: {
          associationCategory: {
            type: "string",
            description: "HUBSPOT_DEFINED or USER_DEFINED",
          },
          associationTypeId: { type: "integer" },
        },
        required: ["associationCategory", "associationTypeId"],
      },
    },
  },
  required: ["to", "types"],
} as const;

const tools: ConnectorToolDefinition[] = [
  // -------------------------------------------------------------------------
  // Contacts (5)
  // -------------------------------------------------------------------------
  {
    catalog: {
      name: "Get Contact By Email",
      description:
        "Look up a HubSpot contact by their email address. Returns id, properties, and timestamps.",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Contact email address" },
          properties: {
            type: "array",
            items: { type: "string" },
            description: "Specific HubSpot contact properties to include",
          },
        },
        required: ["email"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: getContactByEmail,
    responseShape: CONTACT,
  },
  {
    catalog: {
      name: "Get Contact By Phone",
      description:
        "Look up a HubSpot contact by phone or mobile number. Returns up to five matches (HubSpot does not enforce phone uniqueness).",
      inputSchema: {
        type: "object",
        properties: {
          phone: {
            type: "string",
            description: "E.164-formatted phone number",
          },
          properties: {
            type: "array",
            items: { type: "string" },
            description: "Specific HubSpot contact properties to include",
          },
        },
        required: ["phone"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: getContactByPhone,
    responseShape: { results: CONTACT, total: true, paging: true },
  },
  {
    catalog: {
      name: "Search Contacts",
      description:
        "Search HubSpot contacts using a free-text query and/or structured filters (HubSpot search API).",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text query — searches name, email, and company",
          },
          filters: {
            type: "array",
            items: FILTER_ITEM_SCHEMA,
            description: "Structured property filters",
          },
          properties: {
            type: "array",
            items: { type: "string" },
            description: "Properties to return on each match",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Max results (default 25, max 100)",
          },
          after: { type: "string", description: "Cursor for pagination" },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 20,
    },
    handler: searchContacts,
    responseShape: { results: CONTACT, total: true, paging: true },
  },
  {
    catalog: {
      name: "Create Contact",
      description:
        "Create a new HubSpot contact. Pass HubSpot-defined contact properties (e.g. firstname, lastname, email, phone).",
      inputSchema: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description: "HubSpot contact properties keyed by property name",
            additionalProperties: true,
          },
          associations: {
            type: "array",
            items: ASSOCIATION_ITEM_SCHEMA,
            description: "Optional associations to companies, deals, etc.",
          },
        },
        required: ["properties"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: createContact,
    responseShape: CONTACT,
  },
  {
    catalog: {
      name: "Update Contact",
      description:
        "Update a HubSpot contact. Only allowlisted properties may be written: firstname, lastname, email, phone, mobilephone, company, jobtitle, lifecyclestage, hs_lead_status, address, city, state, zip, country, website.",
      inputSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "HubSpot contact ID" },
          properties: {
            type: "object",
            description: "Allowlisted contact properties to update",
            additionalProperties: true,
          },
        },
        required: ["contactId", "properties"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: updateContact,
    responseShape: CONTACT,
  },

  // -------------------------------------------------------------------------
  // Companies (2)
  // -------------------------------------------------------------------------
  {
    catalog: {
      name: "Get Company",
      description: "Get a HubSpot company by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string", description: "HubSpot company ID" },
          properties: {
            type: "array",
            items: { type: "string" },
            description: "Specific HubSpot company properties to include",
          },
        },
        required: ["companyId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: getCompany,
    responseShape: COMPANY,
  },
  {
    catalog: {
      name: "List Companies For Contact",
      description:
        "List all companies associated with a HubSpot contact (via the associations API + batch read).",
      inputSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "HubSpot contact ID" },
        },
        required: ["contactId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: listCompaniesForContact,
    responseShape: { results: COMPANY, total: true },
  },

  // -------------------------------------------------------------------------
  // Deals (3)
  // -------------------------------------------------------------------------
  {
    catalog: {
      name: "List Deals For Contact",
      description:
        "List all deals associated with a HubSpot contact (via the associations API + batch read).",
      inputSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "HubSpot contact ID" },
        },
        required: ["contactId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: listDealsForContact,
    responseShape: { results: DEAL, total: true },
  },
  {
    catalog: {
      name: "Create Deal",
      description:
        "Create a new HubSpot deal. Requires confirmation. If no pipeline is provided, the connector falls back to the connector's `defaultPipelineId` config.",
      inputSchema: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description:
              "HubSpot deal properties (dealname, amount, dealstage, pipeline, closedate, hubspot_owner_id, etc.)",
            additionalProperties: true,
          },
          associations: {
            type: "array",
            items: ASSOCIATION_ITEM_SCHEMA,
            description: "Optional associations to contacts, companies, etc.",
          },
        },
        required: ["properties"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 20,
    },
    handler: createDeal,
    responseShape: DEAL,
  },
  {
    catalog: {
      name: "Update Deal Stage",
      description:
        "Move a HubSpot deal to a new dealstage. Requires confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          dealId: { type: "string", description: "HubSpot deal ID" },
          stage: {
            type: "string",
            description: "Target dealstage ID (pipeline-defined)",
          },
        },
        required: ["dealId", "stage"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 15,
    },
    handler: updateDealStage,
    responseShape: DEAL,
  },

  // -------------------------------------------------------------------------
  // Tickets (7)
  // -------------------------------------------------------------------------
  {
    catalog: {
      name: "Get Ticket",
      description: "Get a HubSpot ticket by ID with its key properties.",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "HubSpot ticket ID" },
          properties: {
            type: "array",
            items: { type: "string" },
            description: "Specific HubSpot ticket properties to include",
          },
        },
        required: ["ticketId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: getTicket,
    responseShape: TICKET,
  },
  {
    catalog: {
      name: "List Tickets For Contact",
      description:
        "List all tickets associated with a HubSpot contact (associations API + batch read).",
      inputSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "HubSpot contact ID" },
        },
        required: ["contactId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: listTicketsForContact,
    responseShape: { results: TICKET, total: true },
  },
  {
    catalog: {
      name: "Search Tickets",
      description:
        "Search HubSpot tickets using a free-text query and/or structured filters.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query" },
          filters: {
            type: "array",
            items: FILTER_ITEM_SCHEMA,
            description: "Structured property filters",
          },
          properties: {
            type: "array",
            items: { type: "string" },
            description: "Properties to return on each match",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Max results (default 25, max 100)",
          },
          after: { type: "string", description: "Cursor for pagination" },
          sortBy: {
            type: "string",
            description: "Property name to sort by (e.g. hs_lastmodifieddate)",
          },
          sortDirection: {
            type: "string",
            enum: ["ASCENDING", "DESCENDING"],
            description: "Sort direction (default DESCENDING)",
          },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 20,
    },
    handler: searchTickets,
    responseShape: { results: TICKET, total: true, paging: true },
  },
  {
    catalog: {
      name: "Create Ticket",
      description:
        "Create a new HubSpot ticket. If no pipeline is provided, falls back to the connector's `defaultTicketPipelineId`.",
      inputSchema: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description:
              "HubSpot ticket properties (subject, content, hs_pipeline, hs_pipeline_stage, hs_ticket_priority, hs_ticket_category, hubspot_owner_id)",
            additionalProperties: true,
          },
          associations: {
            type: "array",
            items: ASSOCIATION_ITEM_SCHEMA,
            description: "Optional associations to contacts, companies, deals",
          },
        },
        required: ["properties"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: createTicket,
    responseShape: TICKET,
  },
  {
    catalog: {
      name: "Update Ticket",
      description:
        "Update a HubSpot ticket. Only allowlisted properties may be written: subject, content, hs_ticket_priority, hs_ticket_category, hubspot_owner_id, hs_pipeline, hs_pipeline_stage. Any hs_pipeline_stage that resolves to a CLOSED stage is rejected — use Close Ticket instead.",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "HubSpot ticket ID" },
          properties: {
            type: "object",
            description: "Allowlisted ticket properties to update",
            additionalProperties: true,
          },
        },
        required: ["ticketId", "properties"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: updateTicket,
    responseShape: TICKET,
  },
  {
    catalog: {
      name: "Close Ticket",
      description:
        "Close a HubSpot ticket. Requires confirmation. The connector resolves the per-pipeline CLOSED stage at runtime (metadata.ticketState === 'CLOSED'); no stage ID is hardcoded.",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "HubSpot ticket ID" },
          closeNote: {
            type: "string",
            description: "Optional resolution note recorded on the ticket",
          },
        },
        required: ["ticketId"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 15,
    },
    handler: closeTicket,
    responseShape: TICKET,
  },
  {
    catalog: {
      name: "Add Reply To Ticket",
      description:
        "Post a reply on the ticket's primary conversation thread via the Conversations API. Channel is inferred from the thread's most recent inbound message. Errors clearly if the ticket has no associated thread.",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "HubSpot ticket ID" },
          text: {
            type: "string",
            description: "Plain-text body of the reply",
          },
          richText: {
            type: "string",
            description:
              "Rich-text (HTML) body of the reply. If omitted, defaults to text.",
          },
          internal: {
            type: "boolean",
            description:
              "Post as an internal comment instead of a customer-facing message (default false)",
          },
        },
        required: ["ticketId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 20,
    },
    handler: addReplyToTicket,
    responseShape: CONVERSATION_MESSAGE,
  },

  // -------------------------------------------------------------------------
  // Engagements (2)
  // -------------------------------------------------------------------------
  {
    catalog: {
      name: "Log Call Engagement",
      description:
        "Log a call engagement against contacts, companies, deals, or tickets.",
      inputSchema: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description:
              "HubSpot call engagement properties (hs_call_title, hs_call_body, hs_call_duration, hs_call_status, hs_call_direction, hs_timestamp, hubspot_owner_id)",
            additionalProperties: true,
          },
          associations: {
            type: "array",
            items: ASSOCIATION_ITEM_SCHEMA,
            description: "Associations to the entities the call relates to",
          },
        },
        required: ["properties"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: logCallEngagement,
    responseShape: ENGAGEMENT,
  },
  {
    catalog: {
      name: "Create Note",
      description:
        "Create an internal HubSpot note (e.g. HITL handoff context). Associates to specified entities.",
      inputSchema: {
        type: "object",
        properties: {
          properties: {
            type: "object",
            description:
              "HubSpot note properties (hs_note_body, hs_timestamp, hubspot_owner_id)",
            additionalProperties: true,
          },
          associations: {
            type: "array",
            items: ASSOCIATION_ITEM_SCHEMA,
            description: "Associations to the entities the note relates to",
          },
        },
        required: ["properties"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 15,
    },
    handler: createNote,
    responseShape: ENGAGEMENT,
  },
];

const hubspotManifest: ConnectorManifest = {
  name: "HubSpot",
  slug: "hubspot",
  description:
    "HubSpot CRM + Service Hub connector. Provides AI-agent tool access to contacts, companies, deals, tickets, and conversations. KB articles are ingested into LoreVault as corpus (internal-only — not agent-callable).",
  connectorType: "api",
  authMethods: ["api_key"],
  iconUrl: "/logos/hubspot.svg",
  configSchema: {
    accessToken: {
      type: "secret",
      required: true,
      description:
        "HubSpot Private App access token. Required scopes documented in the HubSpot Connector Spec §4.",
    },
    portalId: {
      type: "string",
      required: false,
      description:
        "HubSpot portal (hub) ID. Used for deep-link URLs and as source_instance on emitted signals.",
    },
    defaultPipelineId: {
      type: "string",
      required: false,
      description:
        "Default deal pipeline ID. Used by Create Deal when the agent does not specify one.",
    },
    defaultTicketPipelineId: {
      type: "string",
      required: false,
      description:
        "Default ticket pipeline ID. Used by Create Ticket when the agent does not specify one.",
    },
  },
  tools,
  healthCheck,
};

export default hubspotManifest;
