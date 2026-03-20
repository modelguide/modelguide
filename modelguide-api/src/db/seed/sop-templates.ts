/**
 * SOP template seed data — global catalog of reusable SOP blueprints.
 */

import type { SopSchema } from "@features/sops/sops.types";

interface SopTemplateSeed {
  name: string;
  slug: string;
  description: string;
  catalogSlugs: string[];
  version: string;
  isActive: boolean;
  definition: SopSchema;
}

export const sopTemplatesSeed: SopTemplateSeed[] = [
  // ─── Medusa (e-commerce) templates ───────────────────────────────────
  {
    name: "Order Lookup",
    slug: "order-lookup",
    description:
      "Standard procedure for looking up a customer's order status. Verify identity, retrieve order, and communicate status.",
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
  {
    name: "Product Recommendation",
    slug: "product-recommendation",
    description:
      "Guide customers through product discovery based on their needs, budget, and preferences. Present options, educate, and add to cart.",
    catalogSlugs: ["medusa"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: [
            "recommend",
            "suggest",
            "looking for",
            "what do you have",
            "help me find",
          ],
        },
      },
      steps: [
        {
          id: "needs-assessment",
          order: 1,
          instruction:
            "Ask clarifying questions to understand the customer's needs: budget, preferences, use case, or skin/product type.",
          required: true,
        },
        {
          id: "search-products",
          order: 2,
          instruction:
            "Search the product catalog based on the customer's requirements.",
          required: true,
          tool: { toolSlug: "list_products", catalogSlug: "medusa" },
        },
        {
          id: "present-options",
          order: 3,
          instruction:
            "Present 2-3 curated options with brief descriptions, prices, and why each fits the customer's needs.",
          required: true,
        },
        {
          id: "product-education",
          order: 4,
          instruction:
            "Provide detailed information about the selected product if the customer asks follow-up questions.",
          required: false,
          tool: { toolSlug: "get_product", catalogSlug: "medusa" },
        },
        {
          id: "add-to-cart",
          order: 5,
          instruction:
            "Once the customer decides, add the chosen product to their cart and confirm the total.",
          required: false,
          tool: { toolSlug: "add_to_cart", catalogSlug: "medusa" },
        },
        {
          id: "closing",
          order: 6,
          instruction:
            "Confirm next steps (checkout or continue browsing). Thank the customer.",
          required: false,
        },
      ],
      metadata: {
        reasonCode: "REC-001",
        tags: ["product", "recommendation", "purchase"],
        estimatedDuration: "3-8 minutes",
      },
    },
  },
  {
    name: "Safety Escalation",
    slug: "safety-escalation",
    description:
      "Handle safety-related customer reports (allergic reactions, adverse effects, hazardous materials). Prioritize health, document, and escalate.",
    catalogSlugs: ["medusa"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: [
            "allergic",
            "reaction",
            "adverse",
            "hurt",
            "dangerous",
            "emergency",
          ],
        },
      },
      steps: [
        {
          id: "acknowledge-concern",
          order: 1,
          instruction:
            "Immediately acknowledge the safety concern. Express genuine concern for the customer's wellbeing.",
          required: true,
        },
        {
          id: "assess-severity",
          order: 2,
          instruction:
            "Ask the customer to describe what happened. Determine if this requires emergency services (call 911) or is a non-emergency report.",
          required: true,
        },
        {
          id: "lookup-order",
          order: 3,
          instruction:
            "Look up the order to identify the specific product involved.",
          required: true,
          tool: { toolSlug: "get_order", catalogSlug: "medusa" },
        },
        {
          id: "safety-guidance",
          order: 4,
          instruction:
            "Advise the customer to stop using the product immediately. Do not provide medical advice beyond recommending they consult a healthcare professional.",
          required: true,
        },
        {
          id: "create-safety-ticket",
          order: 5,
          instruction:
            "Create a high-priority support ticket for the safety team with full details of the incident.",
          required: true,
          tool: { toolSlug: "create_ticket", catalogSlug: "zendesk" },
        },
        {
          id: "refund-no-return",
          order: 6,
          instruction:
            "Process an immediate full refund. Do not require the customer to return a product that caused an adverse reaction.",
          required: true,
        },
        {
          id: "follow-up-promise",
          order: 7,
          instruction:
            "Promise the safety team will follow up within 24 hours. Provide a reference number.",
          required: true,
        },
      ],
      metadata: {
        reasonCode: "SAFETY-001",
        tags: ["safety", "escalation", "adverse-event"],
        estimatedDuration: "5-10 minutes",
        escalationTriggers: [
          "Customer describes severe symptoms",
          "Multiple reports for same product",
        ],
      },
    },
  },
  {
    name: "Reorder Replenishment",
    slug: "reorder-replenishment",
    description:
      "Help returning customers reorder previously purchased items. Look up order history, check stock, offer alternatives if unavailable.",
    catalogSlugs: ["medusa"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: [
            "reorder",
            "order again",
            "same as last time",
            "need more",
            "replenish",
          ],
        },
      },
      steps: [
        {
          id: "greet",
          order: 1,
          instruction:
            "Greet the customer and ask what they'd like to reorder.",
          required: true,
        },
        {
          id: "lookup-history",
          order: 2,
          instruction:
            "Look up the customer's order history to find the previous purchase.",
          required: true,
          tool: {
            toolSlug: "look_up_order_history",
            catalogSlug: "medusa",
          },
        },
        {
          id: "confirm-items",
          order: 3,
          instruction:
            "Confirm the items from the previous order that the customer wants to reorder.",
          required: true,
        },
        {
          id: "check-availability",
          order: 4,
          instruction:
            "Check current stock availability for the requested items. If out of stock, search for alternatives in the same product line.",
          required: true,
          tool: { toolSlug: "get_product", catalogSlug: "medusa" },
        },
        {
          id: "add-to-cart",
          order: 5,
          instruction:
            "Add confirmed items to cart. Show the total and confirm with the customer.",
          required: true,
          tool: { toolSlug: "add_to_cart", catalogSlug: "medusa" },
        },
        {
          id: "closing",
          order: 6,
          instruction:
            "Confirm delivery details. Respect the customer's closure signals — do not push checkout if the customer indicates they are done.",
          required: false,
          notes:
            "Critical: honor conversation closure cues. If the customer says 'that's it', confirm operational details (callbacks, notifications) and close warmly.",
        },
      ],
      metadata: {
        reasonCode: "REORDER-001",
        tags: ["reorder", "replenishment", "repeat-purchase"],
        estimatedDuration: "3-7 minutes",
      },
    },
  },

  // ─── Zendesk (helpdesk) templates ────────────────────────────────────
  {
    name: "Billing Dispute",
    slug: "billing-dispute",
    description:
      "Handle customer billing inquiries and charge disputes. Investigate charges, explain billing, escalate to billing team if needed.",
    catalogSlugs: ["zendesk"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: [
            "charge",
            "billing",
            "invoice",
            "overcharged",
            "wrong amount",
          ],
        },
      },
      steps: [
        {
          id: "verify-identity",
          order: 1,
          instruction:
            "Verify the customer's identity (name, email, or account number) before accessing billing information.",
          required: true,
        },
        {
          id: "understand-dispute",
          order: 2,
          instruction:
            "Ask the customer to describe the charge in question: amount, date, and what they expected to see.",
          required: true,
        },
        {
          id: "search-tickets",
          order: 3,
          instruction:
            "Search for any existing tickets related to this billing issue.",
          required: true,
          tool: { toolSlug: "search_tickets", catalogSlug: "zendesk" },
        },
        {
          id: "investigate-charge",
          order: 4,
          instruction:
            "Investigate the charge by reviewing the account history. Explain the charge clearly if it is legitimate.",
          required: true,
        },
        {
          id: "create-ticket",
          order: 5,
          instruction:
            "If the dispute cannot be resolved immediately, create a ticket for the billing team with all details and a callback promise.",
          required: true,
          tool: { toolSlug: "create_ticket", catalogSlug: "zendesk" },
        },
        {
          id: "closing",
          order: 6,
          instruction:
            "Provide the ticket number and expected resolution timeline (e.g. callback within 24 hours). Thank the customer.",
          required: true,
        },
      ],
      metadata: {
        reasonCode: "BILL-001",
        tags: ["billing", "dispute", "charge"],
        estimatedDuration: "5-10 minutes",
        escalationTriggers: [
          "Disputed amount over $500",
          "Repeated billing errors on same account",
        ],
      },
    },
  },
  {
    name: "Appointment Scheduling",
    slug: "appointment-scheduling",
    description:
      "Schedule, reschedule, or confirm appointments. Verify identity, present available slots, and confirm booking details.",
    catalogSlugs: ["zendesk"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: [
            "appointment",
            "schedule",
            "book",
            "reschedule",
            "availability",
          ],
        },
      },
      steps: [
        {
          id: "verify-identity",
          order: 1,
          instruction:
            "Verify the patient/customer identity (name + date of birth or account number).",
          required: true,
        },
        {
          id: "determine-type",
          order: 2,
          instruction:
            "Ask whether this is a new appointment, reschedule, or cancellation. Clarify the appointment type (routine, follow-up, specific concern).",
          required: true,
        },
        {
          id: "present-availability",
          order: 3,
          instruction:
            "Present 2-3 available time slots. Include date, time, and provider name.",
          required: true,
        },
        {
          id: "confirm-booking",
          order: 4,
          instruction:
            "Confirm the selected slot with full details: date, time, provider, location.",
          required: true,
        },
        {
          id: "pre-visit-instructions",
          order: 5,
          instruction:
            "Provide any pre-visit instructions (arrive early, bring documents, fasting requirements).",
          required: false,
        },
        {
          id: "create-confirmation-ticket",
          order: 6,
          instruction:
            "Create a confirmation record and promise a reminder notification.",
          required: true,
          tool: { toolSlug: "create_ticket", catalogSlug: "zendesk" },
        },
      ],
      metadata: {
        reasonCode: "APPT-001",
        tags: ["appointment", "scheduling", "booking"],
        estimatedDuration: "3-5 minutes",
      },
    },
  },
  {
    name: "Quote Request",
    slug: "quote-request",
    description:
      "Process a customer quote request. Gather requirements, calculate pricing with volume discounts, and generate a formal quote.",
    catalogSlugs: ["medusa", "zendesk"],
    version: "1.0",
    isActive: true,
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "intent_detected",
        config: {
          patterns: ["quote", "pricing", "bulk order", "how much"],
        },
      },
      steps: [
        {
          id: "gather-requirements",
          order: 1,
          instruction:
            "Ask for product specifications, quantity, delivery requirements, and any special conditions (certifications, material grades).",
          required: true,
        },
        {
          id: "lookup-products",
          order: 2,
          instruction:
            "Look up the requested products in the catalog to verify availability and current pricing.",
          required: true,
          tool: { toolSlug: "list_products", catalogSlug: "medusa" },
        },
        {
          id: "calculate-pricing",
          order: 3,
          instruction:
            "Calculate total pricing including volume discounts. State that pricing is subject to final confirmation and provide validity period (typically 7-14 business days).",
          required: true,
        },
        {
          id: "present-quote",
          order: 4,
          instruction:
            "Present the quote with line items: unit cost, quantity, discount applied, total, and delivery timeline. Include any extras (certificates, free shipping thresholds).",
          required: true,
        },
        {
          id: "formalize-quote",
          order: 5,
          instruction:
            "Generate a formal quote reference number and send to the customer's procurement email address.",
          required: true,
          tool: { toolSlug: "create_ticket", catalogSlug: "zendesk" },
        },
      ],
      metadata: {
        reasonCode: "QUOTE-001",
        tags: ["quote", "pricing", "b2b"],
        estimatedDuration: "5-10 minutes",
        escalationTriggers: [
          "Custom pricing request beyond standard tiers",
          "Order value exceeding $50,000",
        ],
      },
    },
  },
];
