/**
 * Zendesk Support connector module.
 * Provides ticket management, comments, user lookup, and search
 * via the Zendesk Support API v2.
 */

import type { ConnectorManifest, ConnectorToolDefinition } from "../types";
import {
  addComment,
  createTicket,
  getTicket,
  getUser,
  listTicketComments,
  listTickets,
  searchTickets,
  updateTicket,
} from "./handlers";

const tools: ConnectorToolDefinition[] = [
  {
    catalog: {
      name: "List Tickets",
      description: "List tickets with optional pagination and sorting",
      inputSchema: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            description: "Page number (default 1)",
            minimum: 1,
          },
          perPage: {
            type: "integer",
            description: "Number of tickets per page (default 100, max 100)",
            minimum: 1,
            maximum: 100,
          },
          sortBy: {
            type: "string",
            description:
              "Sort field (e.g. created_at, updated_at, priority, status)",
          },
          sortOrder: {
            type: "string",
            description: "Sort direction: asc or desc",
            enum: ["asc", "desc"],
          },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: listTickets,
  },
  {
    catalog: {
      name: "Get Ticket",
      description: "Get detailed information about a specific ticket",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: {
            type: "integer",
            description: "Zendesk ticket ID",
          },
        },
        required: ["ticketId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: getTicket,
  },
  {
    catalog: {
      name: "Create Ticket",
      description:
        "Create a new support ticket. Requester fields are optional — when omitted, the ticket is attributed to the authenticated API user (anonymous drop).",
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Ticket subject line",
          },
          body: {
            type: "string",
            description:
              "Initial comment body (plain text or HTML). Alias: description",
          },
          description: {
            type: "string",
            description:
              "Alias for body — initial comment text. Use body or description, not both.",
          },
          priority: {
            type: "string",
            description: "Ticket priority",
            enum: ["urgent", "high", "normal", "low"],
          },
          type: {
            type: "string",
            description: "Ticket type",
            enum: ["problem", "incident", "question", "task"],
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to apply to the ticket",
          },
          requesterEmail: {
            type: "string",
            description:
              "Requester email address (optional for anonymous drops)",
          },
          requesterName: {
            type: "string",
            description: "Requester display name (optional)",
          },
        },
        required: ["subject"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 60,
    },
    handler: createTicket,
  },
  {
    catalog: {
      name: "Update Ticket",
      description:
        "Update an existing ticket's status, priority, or other fields",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: {
            type: "integer",
            description: "Zendesk ticket ID to update",
          },
          status: {
            type: "string",
            description: "New ticket status",
            enum: ["new", "open", "pending", "hold", "solved", "closed"],
          },
          priority: {
            type: "string",
            description: "New priority level",
            enum: ["urgent", "high", "normal", "low"],
          },
          type: {
            type: "string",
            description: "New ticket type",
            enum: ["problem", "incident", "question", "task"],
          },
          subject: {
            type: "string",
            description: "New subject line",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replace ticket tags",
          },
          assigneeId: {
            type: "integer",
            description: "Assign ticket to this agent ID",
          },
        },
        required: ["ticketId"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 60,
    },
    handler: updateTicket,
  },
  {
    catalog: {
      name: "Add Comment",
      description: "Add a comment to an existing ticket",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: {
            type: "integer",
            description: "Zendesk ticket ID",
          },
          body: {
            type: "string",
            description: "Comment body (plain text or HTML)",
          },
          public: {
            type: "boolean",
            description:
              "Whether the comment is public (default true). Set false for internal notes.",
          },
        },
        required: ["ticketId", "body"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 60,
    },
    handler: addComment,
  },
  {
    catalog: {
      name: "Search Tickets",
      description:
        "Search tickets using Zendesk search syntax. The query is automatically scoped to type:ticket.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query (e.g. 'status:open priority:urgent', 'subject:refund')",
          },
          sortBy: {
            type: "string",
            description:
              "Sort field (e.g. created_at, updated_at, priority, status, ticket_type)",
          },
          sortOrder: {
            type: "string",
            description: "Sort direction: asc or desc",
            enum: ["asc", "desc"],
          },
        },
        required: ["query"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: searchTickets,
  },
  {
    catalog: {
      name: "List Ticket Comments",
      description: "List all comments on a specific ticket",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: {
            type: "integer",
            description: "Zendesk ticket ID",
          },
          page: {
            type: "integer",
            description: "Page number (default 1)",
            minimum: 1,
          },
          perPage: {
            type: "integer",
            description: "Comments per page (default 100, max 100)",
            minimum: 1,
            maximum: 100,
          },
        },
        required: ["ticketId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: listTicketComments,
  },
  {
    catalog: {
      name: "Get User",
      description: "Get details of a Zendesk user by their ID",
      inputSchema: {
        type: "object",
        properties: {
          userId: {
            type: "integer",
            description: "Zendesk user ID",
          },
        },
        required: ["userId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: getUser,
  },
];

const zendeskManifest: ConnectorManifest = {
  name: "Zendesk",
  slug: "zendesk",
  description:
    "Helpdesk connector for managing tickets, comments, and users via the Zendesk Support API",
  connectorType: "api",
  configSchema: {
    subdomain: {
      type: "string",
      required: true,
      description:
        "Zendesk subdomain (e.g. 'mycompany' for mycompany.zendesk.com)",
    },
    email: {
      type: "string",
      required: true,
      description: "Agent email address for API authentication",
    },
    apiToken: {
      type: "secret",
      required: true,
      description: "Zendesk API token for authentication",
    },
  },
  authMethods: ["basic"],
  iconUrl:
    "https://d26a57ydsghvgx.cloudfront.net/www/public/assets/images/logos/zendesk-logo.svg",
  tools,
};

export default zendeskManifest;
