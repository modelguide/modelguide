/**
 * Bank Nowa mock connector.
 * Demo connector for the ModelGuide sales demo (Bank Nowa S.A.).
 * All tool responses are hardcoded fixtures — no external API is called.
 */

import type { ConnectorManifest, ConnectorToolDefinition } from "../types";
import {
  blockCard,
  checkStandingOrders,
  createDispute,
  lookupTransaction,
  orderNewCard,
  verifyCustomer,
} from "./handlers";

const tools: ConnectorToolDefinition[] = [
  {
    catalog: {
      name: "Verify Customer",
      description:
        "Verify customer identity using name, PESEL, and card last 4 digits. Must be called before any account action.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Customer full name",
          },
          pesel: {
            type: "string",
            description: "Customer PESEL number or date of birth",
          },
          card_last4: {
            type: "string",
            description: "Last 4 digits of the card number",
          },
        },
        required: ["name", "pesel", "card_last4"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 10,
    },
    handler: verifyCustomer,
  },
  {
    catalog: {
      name: "Lookup Transaction",
      description:
        "Find a transaction by card ID, amount, and date. Returns merchant name, amount, currency, and date.",
      inputSchema: {
        type: "object",
        properties: {
          card_id: {
            type: "string",
            description: "Card ID from customer verification",
          },
          amount: {
            type: "number",
            description: "Transaction amount in PLN",
          },
          date: {
            type: "string",
            description:
              "Transaction date (YYYY-MM-DD or approximate description)",
          },
        },
        required: ["card_id", "amount", "date"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 10,
    },
    handler: lookupTransaction,
  },
  {
    catalog: {
      name: "Check Standing Orders",
      description:
        "Retrieve all standing orders and auto-payments linked to a card. Always call this before blocking a card.",
      inputSchema: {
        type: "object",
        properties: {
          card_id: {
            type: "string",
            description: "Card ID from customer verification",
          },
        },
        required: ["card_id"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 10,
    },
    handler: checkStandingOrders,
  },
  {
    catalog: {
      name: "Block Card",
      description:
        "Permanently block a card. Only call after customer explicitly confirms and standing orders have been reviewed.",
      inputSchema: {
        type: "object",
        properties: {
          card_id: {
            type: "string",
            description: "Card ID to block",
          },
        },
        required: ["card_id"],
      },
      defaultRequiresConfirmation: true,
      defaultTimeoutSeconds: 10,
    },
    handler: blockCard,
  },
  {
    catalog: {
      name: "Create Dispute",
      description:
        "Open a dispute for an unauthorized transaction. Call after the card has been blocked.",
      inputSchema: {
        type: "object",
        properties: {
          card_id: {
            type: "string",
            description: "Card ID",
          },
          transaction_id: {
            type: "string",
            description: "Transaction ID from lookup (e.g. TXN-881)",
          },
        },
        required: ["card_id", "transaction_id"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 10,
    },
    handler: createDispute,
  },
  {
    catalog: {
      name: "Order New Card",
      description:
        "Order a replacement card. card_type must be 'standard' (5-7 days, free) or 'express' (2 days, 30 PLN).",
      inputSchema: {
        type: "object",
        properties: {
          card_type: {
            type: "string",
            description: "'standard' or 'express'",
            enum: ["standard", "express"],
          },
          delivery_address: {
            type: "string",
            description: "Delivery address as a single string",
          },
        },
        required: ["card_type", "delivery_address"],
      },
      defaultRequiresConfirmation: false,
      defaultTimeoutSeconds: 10,
    },
    handler: orderNewCard,
  },
];

const bankNowaManifest: ConnectorManifest = {
  name: "Bank Nowa (Mock)",
  slug: "bank-nowa",
  description:
    "Mock banking connector for the ModelGuide sales demo. Hardcoded fixture responses — no real API calls.",
  connectorType: "api",
  configSchema: {},
  authMethods: ["none"],
  iconUrl: "/logos/bank-nowa.svg",
  tools,
};

export default bankNowaManifest;
