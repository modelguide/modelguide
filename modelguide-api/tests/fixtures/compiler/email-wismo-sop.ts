/**
 * Email WISMO SOP fixture — matches SopDetailResponse shape.
 *
 * Based on the "Order Not Arrived" procedure from the client's
 * customer service SOPs. Email-specific: one-shot request/reply,
 * no greeting step, intent classification as step 1.
 */

import type { SopDetailResponse } from "@features/compiler/core/types";

export const emailOrderNotArrivedSop: SopDetailResponse = {
  id: "sop-email-order-not-arrived-001",
  name: "Email — Order Not Arrived",
  slug: "email-order-not-arrived",
  description:
    "Process inbound emails about orders that haven't arrived. Classify intent, look up order, calculate SLA (14 working days), compose reply with appropriate response based on whether SLA has expired. Escalate out-of-scope requests to helpdesk.",
  status: "active",
  version: "1.0",
  assignedAgents: [],
  sopTemplateId: null,
  template: null,
  definition: {
    schemaVersion: 1,
    trigger: {
      type: "intent_detected",
      config: {
        patterns: [
          "where is my order",
          "order not arrived",
          "order status",
          "haven't received my order",
          "still waiting for my order",
          "when will my order be delivered",
        ],
      },
    },
    steps: [
      {
        id: "classify-intent",
        order: 1,
        instruction:
          "Determine if this email is about an order that hasn't arrived (WISMO / delivery status) or out-of-scope (damaged items, returns, refunds, account issues). If out-of-scope, skip to the escalation step.",
        required: true,
      },
      {
        id: "extract-order-number",
        order: 2,
        instruction:
          "Extract the order number from the email subject line or body. Order numbers are integers, often prefixed with '#' (e.g., '#1042', 'order 1042'). If no order number is found, compose a reply asking the customer to provide their order number.",
        required: true,
      },
      {
        id: "lookup-order",
        order: 3,
        instruction:
          "Look up the order using the extracted order number and customer email.",
        required: true,
        tool: {
          connectorToolId: "00000000-0000-0000-0000-000000000001",
          connectorId: "00000000-0000-0000-0000-000000000010",
          resolvedName: "store_look_up_order",
        },
      },
      {
        id: "compose-reply",
        order: 4,
        instruction:
          "Compose an email reply based on the order lookup result and SLA rules. Greet the customer by name and thank them for contacting us. Reference their order ID and order date. Standard delivery is 3-5 working days, but customers should allow up to 14 working days from the order date. Calculate the SLA expiry date (order date + 14 working days, excluding weekends). If the order is WITHIN the 14-day window: inform the customer their order is still within the delivery window and advise them to wait until the SLA expiry date. If the order is PAST the 14-day window: acknowledge the delay and offer a full refund or replacement — ask which they prefer. Always offer further assistance at the end. Keep it professional and warm, do not ask unnecessary follow-up questions — this is a one-shot reply.",
        required: true,
      },
      {
        id: "escalate-if-needed",
        order: 5,
        instruction:
          "If the request was out-of-scope or the order lookup failed, create a helpdesk ticket with the original email subject, sender email, email body, and tags ['email', 'escalated-by-bot']. Include the ticket number in the reply to the customer and inform them the support team will respond within 24 hours.",
        required: false,
        tool: {
          connectorToolId: "00000000-0000-0000-0000-000000000002",
          connectorId: "00000000-0000-0000-0000-000000000020",
          resolvedName: "helpdesk_create_ticket",
        },
      },
    ],
    metadata: {
      reasonCode: "WISMO-001",
      tags: ["order", "delivery", "not-arrived", "email"],
      estimatedDuration: "single-shot",
      escalationTriggers: [
        "Request is not about order status or delivery",
        "Order lookup fails or returns unexpected error",
        "Customer expresses extreme dissatisfaction after SLA explanation",
      ],
    },
  },
  createdBy: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: null,
};
