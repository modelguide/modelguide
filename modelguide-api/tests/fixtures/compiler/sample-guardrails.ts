/**
 * Sample guardrails fixture — matches KnowledgeBaseDetailResponse shape.
 *
 * Derived from the "General Guidelines" in the client's customer service SOPs.
 */

import type { KnowledgeBaseDetailResponse } from "@features/compiler/core/types";

export const sampleGuardrails: KnowledgeBaseDetailResponse[] = [
  {
    id: "gr-tone-001",
    type: "guardrail",
    name: "Brand Tone — Warm Professional",
    slug: "brand-tone-warm-professional",
    content:
      "Always greet the customer by name and thank them for contacting us. Use a warm, professional tone throughout. Avoid jargon and overly formal language. Be empathetic when the customer has had a negative experience. Apologise sincerely when appropriate. Offer further assistance at the end of every response.",
    description: null,
    config: {
      category: "brand",
      priority: "critical",
    },
    isActive: true,
    assignedAgents: [],
    createdBy: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: null,
  },
  {
    id: "gr-delivery-sla-001",
    type: "guardrail",
    name: "Delivery SLA Rules",
    slug: "delivery-sla-rules",
    content:
      "Standard delivery estimate is 3-5 working days. Customers should allow up to 14 working days from the order date before contacting us. Calculate working days excluding weekends. If within 14 working days: advise the customer their order is still within the delivery window. If past 14 working days: the customer is entitled to a full refund or replacement — offer both options.",
    description: null,
    config: {
      category: "operational",
      priority: "critical",
    },
    isActive: true,
    assignedAgents: [],
    createdBy: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: null,
  },
  {
    id: "gr-no-promises-001",
    type: "guardrail",
    name: "No Premature Promises",
    slug: "no-premature-promises",
    content:
      "Never promise a specific outcome (refund, replacement, resolution) until all required information has been gathered and verified. Do not guarantee delivery dates unless confirmed by tracking data.",
    description: null,
    config: {
      category: "compliance",
      priority: "high",
    },
    isActive: true,
    assignedAgents: [],
    createdBy: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: null,
  },
  {
    id: "gr-escalation-001",
    type: "guardrail",
    name: "Escalation Protocol",
    slug: "escalation-protocol",
    content:
      "Escalate to a human agent via helpdesk ticket if: the request is out of scope for the current SOP, the customer requests a supervisor, or the customer expresses extreme dissatisfaction. Do not attempt to handle out-of-scope requests — create a ticket and inform the customer the support team will respond.",
    description: null,
    config: {
      category: "operational",
      priority: "high",
    },
    isActive: true,
    assignedAgents: [],
    createdBy: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: null,
  },
  {
    id: "gr-pii-001",
    type: "guardrail",
    name: "PII Handling",
    slug: "pii-handling",
    content:
      "Never repeat back full credit card numbers or passwords. Mask sensitive data in responses. Do not expose internal tool error messages or system details to the customer.",
    description: null,
    config: {
      category: "safety",
      priority: "critical",
    },
    isActive: true,
    assignedAgents: [],
    createdBy: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: null,
  },
];
