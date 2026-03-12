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
  healthCheck,
  listProducts,
  lookUpOrder,
  lookUpOrderHistory,
  setDeliveryAddress,
} from "./handlers";
import { CART, ORDER, PRODUCT } from "./response-shapes";

const tools: ConnectorToolDefinition[] = [
  {
    catalog: {
      name: "List Products",
      description:
        "Search the store catalog for products by name, brand, or category. Returns variant-level stock availability.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Product search term — name, brand, or category (e.g. 'CeraVe', 'lipstick', 'moisturizer')",
          },
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
        required: ["query"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: listProducts,
    responseShape: {
      products: PRODUCT,
      count: true,
      limit: true,
      offset: true,
    },
  },
  {
    catalog: {
      name: "Get Product",
      description:
        "Get product details (price, description, variants, inventory quantity). Use a product ID returned by search.",
      inputSchema: {
        type: "object",
        properties: {
          productId: {
            type: "string",
            description: "Product ID from search results",
          },
        },
        required: ["productId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: getProduct,
    responseShape: { product: PRODUCT },
  },
  {
    catalog: {
      name: "Create Cart",
      description: "Start a new shopping cart for the customer",
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
          email: {
            type: "string",
            description: "Customer email address for the cart",
          },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: createCart,
    responseShape: { cart: CART },
  },
  {
    catalog: {
      name: "Add to Cart",
      description:
        "Add a product to the cart. Requires a variant ID from product details.",
      inputSchema: {
        type: "object",
        properties: {
          cartId: { type: "string", description: "Cart ID from cart creation" },
          variantId: {
            type: "string",
            description:
              "Product variant ID — use the variant returned by product search or details",
          },
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
    responseShape: { cart: CART },
  },
  {
    catalog: {
      name: "Get Cart",
      description: "Show what is currently in the cart with prices and totals",
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
    responseShape: { cart: CART },
  },
  {
    catalog: {
      name: "Set Delivery Address",
      description: "Save the customer's delivery address on the cart",
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
    responseShape: { cart: CART },
  },
  {
    catalog: {
      name: "Complete Cart",
      description:
        "Finalize the order and create it from the cart — only after the customer confirms",
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
    responseShape: { type: true, order: ORDER, cart: CART },
  },
  {
    catalog: {
      name: "Get Order",
      description: "Look up an order by ID to check its status and contents",
      inputSchema: {
        type: "object",
        properties: {
          orderId: {
            type: "string",
            description: "Order ID provided by the customer",
          },
        },
        required: ["orderId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: getOrder,
    responseShape: { order: ORDER },
  },
  {
    catalog: {
      name: "Look Up Order",
      description:
        "Find a specific order by customer email and order number (requires admin API token)",
      inputSchema: {
        type: "object",
        properties: {
          email: {
            type: "string",
            description: "Customer email address",
          },
          displayId: {
            type: "integer",
            description: "Order number (e.g. 1001)",
          },
        },
        required: ["email", "displayId"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: lookUpOrder,
    responseShape: ORDER,
  },
  {
    catalog: {
      name: "Look Up Order History",
      description:
        "Retrieve a customer's order history with products, totals, and delivery addresses (requires admin API token). Returns newest orders first. Use limit/offset to paginate. Provide either customerId or email.",
      inputSchema: {
        type: "object",
        properties: {
          customerId: {
            type: "string",
            description:
              "Medusa customer ID (e.g. cus_01J...). Provide this or email.",
          },
          email: {
            type: "string",
            description:
              "Customer email address. Used to look up the customer ID if customerId is not provided.",
          },
          limit: {
            type: "integer",
            description: "Max orders to return (default 5, max 50)",
            minimum: 1,
            maximum: 50,
          },
          offset: {
            type: "integer",
            description: "Number of orders to skip for pagination (default 0)",
            minimum: 0,
          },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 30,
    },
    handler: lookUpOrderHistory,
    responseShape: {
      orders: ORDER,
      count: true,
      limit: true,
      offset: true,
    },
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
    secretApiKey: {
      type: "secret",
      required: false,
      description:
        "Admin API token for order lookup (required for admin tools)",
    },
  },
  authMethods: ["api_key"],
  iconUrl: "/logos/medusa.svg",
  tools,
  healthCheck,
};

export default medusaManifest;
