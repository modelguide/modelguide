/**
 * Medusa E-commerce connector module.
 * Provides product browsing, cart management, checkout, and order tools
 * via the Medusa v2 Store API.
 */

import type { ConnectorManifest, ConnectorToolDefinition } from "../types";
import {
  addToCart,
  completeCart,
  createCart,
  getCart,
  getOrder,
  getProduct,
  listProducts,
  setDeliveryAddress,
} from "./handlers";

const tools: ConnectorToolDefinition[] = [
  {
    catalog: {
      name: "List Products",
      description:
        "Browse available products with optional search and pagination",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query to filter products" },
          limit: {
            type: "integer",
            description: "Maximum number of products to return (default 20)",
            minimum: 1,
            maximum: 100,
          },
          offset: {
            type: "integer",
            description: "Number of products to skip for pagination",
            minimum: 0,
          },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: listProducts,
  },
  {
    catalog: {
      name: "Get Product",
      description: "Get detailed information about a specific product",
      inputSchema: {
        type: "object",
        properties: {
          productId: { type: "string", description: "Product ID" },
        },
        required: ["productId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: getProduct,
  },
  {
    catalog: {
      name: "Create Cart",
      description: "Create a new shopping cart",
      inputSchema: {
        type: "object",
        properties: {
          regionId: {
            type: "string",
            description: "Region ID for the cart",
          },
          currencyCode: {
            type: "string",
            description: "Currency code (e.g., usd, eur)",
          },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: createCart,
  },
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
    handler: addToCart,
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
    handler: getCart,
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
    handler: setDeliveryAddress,
  },
  {
    catalog: {
      name: "Complete Cart",
      description:
        "Complete the cart checkout and create an order from the cart",
      inputSchema: {
        type: "object",
        properties: {
          cartId: {
            type: "string",
            description: "Cart ID to complete checkout",
          },
        },
        required: ["cartId"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 60,
    },
    handler: completeCart,
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
    handler: getOrder,
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
    publishableKey: {
      type: "string",
      required: true,
      description: "Publishable API key for storefront",
    },
  },
  authMethods: ["api_key"],
  iconUrl: "https://medusajs.com/images/logo.svg",
  tools,
};

export default medusaManifest;
