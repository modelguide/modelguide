/**
 * SOP template seed data — global catalog of reusable SOP blueprints.
 */

import type { SopSchema } from "@features/sops/sops.types";

interface SopTemplateSeed {
  name: string;
  slug: string;
  description: string;
  category: string;
  catalogSlugs: string[];
  version: string;
  isActive: boolean;
  definition: SopSchema;
}

export const sopTemplatesSeed: SopTemplateSeed[] = [
  {
    name: "Order Lookup",
    slug: "order-lookup",
    description:
      "Standard procedure for looking up a customer's order status. Verify identity, retrieve order, and communicate status.",
    category: "Order Management",
    catalogSlugs: ["medusa"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: ["where is my order", "order status", "track order"],
        },
      },
      steps: [
        {
          id: "greet",
          order: 1,
          instruction: "Greet the customer and ask how you can help.",
          required: true,
        },
        {
          id: "verify-identity",
          order: 2,
          instruction:
            "Ask for the customer's email address or order number to verify their identity.",
          required: true,
        },
        {
          id: "lookup-order",
          order: 3,
          instruction:
            "Look up the customer's order using the provided identifier.",
          required: true,
          tool: {
            toolSlug: "get_order",
            catalogSlug: "medusa",
          },
        },
        {
          id: "communicate-status",
          order: 4,
          instruction:
            "Communicate the order status clearly. Include expected delivery date if available.",
          required: true,
        },
        {
          id: "offer-help",
          order: 5,
          instruction:
            "Ask if there's anything else you can help with before ending the interaction.",
          required: false,
        },
      ],
      metadata: {
        reasonCode: "WISMO-001",
        tags: ["order", "status", "tracking"],
        estimatedDuration: "2-5 minutes",
      },
    },
  },
  {
    name: "Return an Item",
    slug: "return-item",
    description:
      "Standard procedure for processing a customer return request. Verify purchase, check eligibility, and initiate return.",
    category: "Returns",
    catalogSlugs: ["medusa"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: { patterns: ["return", "send back", "refund", "exchange"] },
      },
      steps: [
        {
          id: "greet",
          order: 1,
          instruction:
            "Greet the customer and acknowledge their return request.",
          required: true,
        },
        {
          id: "verify-identity",
          order: 2,
          instruction:
            "Verify the customer's identity by asking for their email or order number.",
          required: true,
        },
        {
          id: "lookup-order",
          order: 3,
          instruction: "Look up the original order to verify the purchase.",
          required: true,
          tool: {
            toolSlug: "get_order",
            catalogSlug: "medusa",
          },
        },
        {
          id: "check-eligibility",
          order: 4,
          instruction:
            "Check if the item is eligible for return based on the return policy (within 30 days, unused condition).",
          required: true,
        },
        {
          id: "process-return",
          order: 5,
          instruction:
            "If eligible, initiate the return process and provide the customer with return instructions.",
          required: true,
        },
        {
          id: "confirm-refund",
          order: 6,
          instruction:
            "Confirm the refund timeline and method with the customer.",
          required: true,
        },
        {
          id: "closing",
          order: 7,
          instruction:
            "Thank the customer and ask if there's anything else you can help with.",
          required: false,
        },
      ],
      metadata: {
        reasonCode: "RET-001",
        tags: ["return", "refund", "exchange"],
        estimatedDuration: "5-10 minutes",
        escalationTriggers: [
          "Item damaged on arrival",
          "Return window exceeded but customer is a VIP",
        ],
      },
    },
  },
  {
    name: "Damaged Item Report",
    slug: "damaged-item",
    description:
      "Procedure for handling customer reports of damaged items received. Document damage, offer resolution.",
    category: "Returns",
    catalogSlugs: ["medusa"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: ["damaged", "broken", "defective", "arrived damaged"],
        },
      },
      steps: [
        {
          id: "greet-empathize",
          order: 1,
          instruction:
            "Greet the customer and express empathy about the damaged item.",
          required: true,
        },
        {
          id: "verify-identity",
          order: 2,
          instruction:
            "Verify the customer's identity and locate the original order.",
          required: true,
        },
        {
          id: "lookup-order",
          order: 3,
          instruction: "Look up the order details.",
          required: true,
          tool: {
            toolSlug: "get_order",
            catalogSlug: "medusa",
          },
        },
        {
          id: "document-damage",
          order: 4,
          instruction:
            "Ask the customer to describe the damage. Note specifics for the report.",
          required: true,
        },
        {
          id: "offer-resolution",
          order: 5,
          instruction:
            "Offer resolution options: replacement shipment or full refund. Prioritize replacement.",
          required: true,
        },
        {
          id: "closing",
          order: 6,
          instruction:
            "Confirm next steps and timeline. Thank the customer for their patience.",
          required: false,
        },
      ],
      metadata: {
        reasonCode: "DMG-001",
        tags: ["damaged", "quality", "replacement"],
        estimatedDuration: "5-8 minutes",
        escalationTriggers: [
          "Multiple damaged items in same order",
          "High-value item over $500",
        ],
      },
    },
  },
];
