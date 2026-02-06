/**
 * Medusa E-commerce connector module.
 * Provides cart, order, and address management tools.
 */

import type { ConnectorManifest, ConnectorToolDefinition } from "../types";

function stubHandler(toolName: string): ConnectorToolDefinition["handler"] {
  return async (ctx) => ({
    success: true,
    data: {
      message: `${toolName} executed (stub)`,
      input: ctx.input,
    },
  });
}

const tools: ConnectorToolDefinition[] = [
  {
    catalog: {
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
    handler: stubHandler("Add to Cart"),
  },
  {
    catalog: {
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
    handler: stubHandler("Get Cart"),
  },
  {
    catalog: {
      name: "Create Draft Order",
      description: "Create a draft order from the cart",
      inputSchema: {
        type: "object",
        properties: {
          cartId: {
            type: "string",
            description: "Cart ID to convert to order",
          },
        },
        required: ["cartId"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 60,
    },
    handler: stubHandler("Create Draft Order"),
  },
  {
    catalog: {
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
    handler: stubHandler("Set Delivery Address"),
  },
  {
    catalog: {
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
    handler: stubHandler("Confirm Order"),
  },
  {
    catalog: {
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
    handler: stubHandler("Get Order"),
  },
  {
    catalog: {
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
    handler: stubHandler("Update Order Address"),
  },
  {
    catalog: {
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
    handler: stubHandler("Cancel Order"),
  },
];

const medusaManifest: ConnectorManifest = {
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
  authMethods: ["api_key"],
  iconUrl: "https://medusajs.com/images/logo.svg",
  tools,
};

export default medusaManifest;
