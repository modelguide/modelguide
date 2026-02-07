/**
 * Seed data for connectors catalog.
 * These are the global connector templates available to all organizations.
 *
 * Connector modules that have a manifest (in features/connectors/catalog/)
 * are converted via manifestToSeed to avoid duplicating tool definitions.
 */

import medusaManifest from "@features/connectors/catalog/medusa/index";
import type { ConnectorManifest } from "@features/connectors/catalog/types";
import type { CatalogTool, NewConnectorCatalog } from "../schema";

/**
 * Derives a seed-ready catalog entry from a connector manifest,
 * stripping handler functions and keeping only catalog metadata.
 */
function manifestToSeed(manifest: ConnectorManifest): NewConnectorCatalog {
  return {
    name: manifest.name,
    slug: manifest.slug,
    description: manifest.description,
    connectorType: manifest.connectorType,
    configSchema: manifest.configSchema,
    tools: manifest.tools.map((t) => t.catalog),
    authMethods: manifest.authMethods,
    iconUrl: manifest.iconUrl,
    isActive: true,
  };
}

// ============================================================================
// Medusa E-commerce Connector (derived from manifest)
// ============================================================================

export const medusaConnector: NewConnectorCatalog =
  manifestToSeed(medusaManifest);

// ============================================================================
// Zendesk Helpdesk Connector
// ============================================================================

const zendeskTools: CatalogTool[] = [
  {
    name: "Create Ticket",
    description: "Create a new support ticket",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Ticket subject" },
        description: { type: "string", description: "Ticket description" },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Ticket priority",
        },
        requesterEmail: {
          type: "string",
          description: "Email of the requester",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to apply to the ticket",
        },
      },
      required: ["subject", "description", "requesterEmail"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Get Ticket",
    description: "Retrieve details of an existing ticket",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "Ticket ID" },
      },
      required: ["ticketId"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Update Ticket",
    description: "Update an existing ticket's properties",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "Ticket ID" },
        status: {
          type: "string",
          enum: ["new", "open", "pending", "hold", "solved", "closed"],
          description: "New ticket status",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "New ticket priority",
        },
        assigneeId: {
          type: "string",
          description: "Agent ID to assign ticket to",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to set on the ticket",
        },
      },
      required: ["ticketId"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Add Comment",
    description: "Add a comment to an existing ticket",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "Ticket ID" },
        body: { type: "string", description: "Comment text" },
        public: {
          type: "boolean",
          description: "Whether the comment is public (visible to requester)",
          default: true,
        },
      },
      required: ["ticketId", "body"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Close Ticket",
    description: "Close a ticket and mark it as resolved",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "Ticket ID to close" },
        resolution: { type: "string", description: "Resolution note" },
      },
      required: ["ticketId"],
    },
    defaultRequiresConfirmation: true,
    defaultTimeoutSeconds: 30,
  },
];

export const zendeskConnector: NewConnectorCatalog = {
  name: "Zendesk",
  slug: "zendesk",
  description:
    "Helpdesk platform connector for managing support tickets and customer communications",
  connectorType: "api",
  configSchema: {
    subdomain: {
      type: "string",
      required: true,
      description:
        "Zendesk subdomain (e.g., 'company' for company.zendesk.com)",
    },
    email: {
      type: "string",
      required: true,
      description: "Agent email address",
    },
    apiToken: {
      type: "secret",
      required: true,
      description: "Zendesk API token",
    },
  },
  tools: zendeskTools,
  authMethods: ["api_key"],
  iconUrl:
    "https://d26a57ydsghvgx.cloudfront.net/www/public/assets/images/zendesk-logomark.svg",
  isActive: true,
};

// ============================================================================
// Export all catalog entries
// ============================================================================

export const connectorsCatalogSeed: NewConnectorCatalog[] = [
  medusaConnector,
  zendeskConnector,
];
