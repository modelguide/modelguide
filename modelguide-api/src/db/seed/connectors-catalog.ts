/**
 * Seed data for connectors catalog
 * These are the global connector templates available to all organizations
 */

import type { CatalogTool, NewConnectorCatalog } from "../schema";

// ============================================================================
// Medusa E-commerce Connector
// ============================================================================

const medusaTools: CatalogTool[] = [
  {
    name: "Add to Cart",
    description: "Add an item to the customer's shopping cart",
    inputSchema: {
      type: "object",
      properties: {
        cartId: { type: "string", description: "Cart ID" },
        variantId: { type: "string", description: "Product variant ID" },
        quantity: {
          type: "integer",
          description: "Quantity to add",
          minimum: 1,
        },
      },
      required: ["cartId", "variantId", "quantity"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Get Cart",
    description: "Retrieve the current contents of a shopping cart",
    inputSchema: {
      type: "object",
      properties: {
        cartId: { type: "string", description: "Cart ID" },
      },
      required: ["cartId"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Create Draft Order",
    description: "Create a draft order from the cart",
    inputSchema: {
      type: "object",
      properties: {
        cartId: { type: "string", description: "Cart ID to convert to order" },
      },
      required: ["cartId"],
    },
    defaultRequiresConfirmation: true,
    defaultTimeoutSeconds: 60,
  },
  {
    name: "Set Delivery Address",
    description: "Set or update the delivery address for a cart",
    inputSchema: {
      type: "object",
      properties: {
        cartId: { type: "string", description: "Cart ID" },
        address: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
            address1: { type: "string" },
            address2: { type: "string" },
            city: { type: "string" },
            postalCode: { type: "string" },
            countryCode: { type: "string" },
            phone: { type: "string" },
          },
          required: [
            "firstName",
            "lastName",
            "address1",
            "city",
            "postalCode",
            "countryCode",
          ],
        },
      },
      required: ["cartId", "address"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Confirm Order",
    description: "Confirm and finalize an order",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order ID to confirm" },
      },
      required: ["orderId"],
    },
    defaultRequiresConfirmation: true,
    defaultTimeoutSeconds: 60,
  },
  {
    name: "Get Order",
    description: "Retrieve details of an existing order",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order ID" },
      },
      required: ["orderId"],
    },
    defaultRequiresConfirmation: false,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Update Order Address",
    description: "Update the shipping address of an existing order",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order ID" },
        address: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
            address1: { type: "string" },
            address2: { type: "string" },
            city: { type: "string" },
            postalCode: { type: "string" },
            countryCode: { type: "string" },
            phone: { type: "string" },
          },
        },
      },
      required: ["orderId", "address"],
    },
    defaultRequiresConfirmation: true,
    defaultTimeoutSeconds: 30,
  },
  {
    name: "Cancel Order",
    description: "Cancel an existing order",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Order ID to cancel" },
        reason: { type: "string", description: "Reason for cancellation" },
      },
      required: ["orderId"],
    },
    defaultRequiresConfirmation: true,
    defaultTimeoutSeconds: 60,
  },
];

export const medusaConnector: NewConnectorCatalog = {
  name: "Medusa",
  slug: "medusa",
  description:
    "E-commerce platform connector for managing carts, orders, and customers",
  connectorType: "api",
  configSchema: {
    baseUrl: {
      type: "string",
      required: true,
      description: "Medusa API base URL",
    },
    apiToken: {
      type: "secret",
      required: true,
      description: "API authentication token",
    },
    publishableKey: {
      type: "string",
      required: false,
      description: "Publishable API key for storefront",
    },
  },
  tools: medusaTools,
  authMethods: ["api_key"],
  iconUrl: "https://medusajs.com/images/logo.svg",
  isActive: true,
};

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
