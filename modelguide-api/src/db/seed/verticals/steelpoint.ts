/**
 * SteelPoint Supply — B2B industrial supply vertical.
 * Use case: Quotes, bulk order placement, technical specs.
 * Channel mix: email/slack-heavy (25% email, 15% slack) — typical for B2B.
 * Timezone: Europe/Warsaw (inspired by tim.pl).
 */

import type { OrgVerticalConfig } from "./types";

const config: OrgVerticalConfig = {
  org: {
    name: "SteelPoint Supply",
    slug: "steelpoint",
    timezone: "Europe/Warsaw",
    features: ["voice-agents", "chat-agents"],
  },

  users: {
    admin: {
      email: "delivered+admin-steelpoint@resend.dev",
      name: "Tomasz Kowalski",
    },
    support: {
      email: "delivered+support-steelpoint@resend.dev",
      name: "Anna Nowak",
    },
    viewer: {
      email: "demo-viewer-steelpoint@modelguide.dev",
      name: "Demo Viewer",
    },
    inactive: {
      email: "delivered+inactive-steelpoint@resend.dev",
      name: "Former Employee",
    },
  },

  ecommerce: {
    connectorName: "SteelPoint Catalog",
    connectorSlug: "steelpoint_catalog",
    config: {
      baseUrl: "https://api.steelpoint-supply.example.com",
      publishableKey: "pk_steelpoint_placeholder",
    },
  },

  helpdesk: {
    connectorName: "SteelPoint Support",
    connectorSlug: "steelpoint_support",
    config: {
      subdomain: "steelpoint",
      email: "support@steelpoint-supply.example.com",
    },
  },

  agents: [
    {
      name: "SteelPoint Sales Line",
      slug: "steelpoint-sales-line",
      description:
        "Handles phone inquiries for quotes, bulk orders, technical specs, and delivery scheduling",
    },
    {
      name: "SteelPoint Order Portal Bot",
      slug: "steelpoint-order-portal",
      description:
        "Web portal chatbot for placing orders, checking stock, requesting quotes, and account management",
    },
  ],

  products: [
    {
      name: "Steel Pipe DN50 S235",
      price: 42,
      variants: ["6m", "12m"],
      category: "pipes",
    },
    {
      name: "Hydraulic Cylinder 100mm",
      price: 890,
      variants: ["500mm stroke", "1000mm stroke"],
      category: "hydraulics",
    },
    {
      name: "Bearing SKF 6205",
      price: 18,
      variants: ["Open", "Sealed", "Shielded"],
      category: "bearings",
    },
    {
      name: "Welding Wire ER70S-6",
      price: 55,
      variants: ["0.8mm", "1.0mm", "1.2mm"],
      category: "welding",
    },
    {
      name: "Safety Helmet EN397",
      price: 25,
      variants: ["White", "Yellow", "Blue"],
      category: "ppe",
    },
    {
      name: 'Pneumatic Fitting 1/4"',
      price: 3,
      variants: ["Straight", "Elbow", "Tee"],
      category: "pneumatics",
    },
    {
      name: "Cutting Disc 125mm",
      price: 4,
      variants: ["Metal", "Stainless", "Stone"],
      category: "abrasives",
    },
    {
      name: "Industrial Motor 2.2kW",
      price: 450,
      variants: ["1400rpm", "2800rpm"],
      category: "motors",
    },
  ],

  ticketTemplates: [
    {
      subject: "Delivery delayed — production line stopped",
      priority: "urgent",
      type: "problem",
      tags: ["delivery", "critical", "production"],
    },
    {
      subject: "Quote request for bulk pipe order",
      priority: "high",
      type: "task",
      tags: ["quote", "sales", "bulk"],
    },
    {
      subject: "Material certificate 3.1 required for steel pipes",
      priority: "normal",
      type: "task",
      tags: ["documentation", "cert", "compliance"],
    },
    {
      subject: "Wrong specification shipped — DN40 instead of DN50",
      priority: "high",
      type: "problem",
      tags: ["wrong-item", "spec", "urgent"],
    },
    {
      subject: "Invoice correction required — wrong PO reference",
      priority: "normal",
      type: "problem",
      tags: ["billing", "invoice"],
    },
    {
      subject: "Technical specs inquiry — motor torque curves",
      priority: "low",
      type: "question",
      tags: ["technical", "specs"],
    },
  ],

  generalQA: [
    {
      q: "What's your minimum order quantity?",
      a: "Minimum order is €50 net. For individual items there's no minimum quantity — you can order single pieces. For custom-cut materials, minimum lengths apply (typically 1m for pipes, 0.5m² for plates).",
    },
    {
      q: "Do you offer next-day delivery?",
      a: "Yes, for in-stock items ordered before 14:00 CET, we offer next-business-day delivery within Poland and Germany. Express delivery to other EU countries takes 2-3 business days.",
    },
    {
      q: "Can you provide material certificates?",
      a: "Absolutely. We provide EN 10204 Type 3.1 certificates for all structural steel and pressure-rated components. Certificates are included free of charge and attached to the delivery note.",
    },
    {
      q: "What payment terms do you offer?",
      a: "New accounts start with prepayment or card. After 3 successful orders, we offer Net 30 terms. For established accounts with volume over €10,000/month, Net 60 is available upon approval.",
    },
    {
      q: "Do you cut to custom lengths?",
      a: "Yes, we offer precision cutting for pipes, profiles, and plates. Tolerances are ±1mm for saw cuts and ±0.5mm for plasma/laser cuts. Custom cuts add 1 business day to delivery.",
    },
    {
      q: "What's your returns policy?",
      a: "Standard items can be returned within 14 days in original packaging. Custom-cut materials and special orders are non-returnable. Defective items are replaced or refunded within 48 hours of notification.",
    },
  ],

  orderPrefix: "SP-",
  ticketIdRange: [30000, 39999],
  baseUrl: "https://steelpoint-supply.example.com",
  helpdeskBaseUrl: "https://steelpoint.zendesk.com",

  scenarioWeights: [
    { value: "product_inquiry", weight: 20 },
    { value: "purchase_flow", weight: 15 },
    { value: "order_status", weight: 15 },
    { value: "return_exchange", weight: 5 },
    { value: "ticket_lookup", weight: 15 },
    { value: "ticket_creation", weight: 15 },
    { value: "ticket_escalation", weight: 10 },
    { value: "general_question", weight: 5 },
  ],

  channelWeights: [
    { value: "email", weight: 25 },
    { value: "web", weight: 20 },
    { value: "voice", weight: 15 },
    { value: "slack", weight: 15 },
    { value: "api", weight: 10 },
    { value: "widget", weight: 8 },
    { value: "whatsapp", weight: 5 },
    { value: "sms", weight: 2 },
  ],

  feedback: {
    positiveCustomer: [
      "Delivery on time, as always",
      "Competitive pricing on bulk order",
      "Certificate provided immediately",
      "Quick turnaround on the quote",
      "Technical specs were exactly what we needed",
      "Great account management",
      "Smooth ordering process",
      "Stock availability was confirmed instantly",
    ],
    negativeCustomer: [
      "Delivery was 2 days late",
      "Wrong specification shipped",
      "Invoice had incorrect PO reference",
      "Expected faster quote response",
      "Material certificate was missing",
      "Packaging was insufficient for heavy items",
    ],
    positiveSupport: [
      "Correct technical specification provided",
      "Properly escalated production-critical delay",
      "Good handling of specification mismatch",
      "Quote included all required line items",
      "Verified stock before confirming delivery date",
    ],
    negativeSupport: [
      "Should have flagged specification discrepancy earlier",
      "Missing freight cost in quote",
      "Didn't confirm lead time for non-stock items",
      "Should have offered alternative when item was out of stock",
    ],
  },

  handwrittenSessions: [
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      userIdentifier: "+48-22-555-0101",
      hoursAgo: 2,
      messages: [
        {
          role: "user",
          content:
            "Good morning. I need a quote for 200 meters of DN50 steel pipe, grade S235.",
        },
        {
          role: "assistant",
          content:
            "Good morning! I can prepare that quote for you. Would you prefer 6-meter or 12-meter lengths?",
        },
        {
          role: "user",
          content:
            "12-meter lengths. We also need material certificates 3.1 for the entire batch.",
        },
        {
          role: "assistant",
          content:
            "Understood. 200m of Steel Pipe DN50 S235 in 12m lengths — that's 17 pieces (204m total). At €42 per length, that comes to €714 before volume discount. For this quantity, I can offer 12% off, bringing it to €628.32. Certificates 3.1 are included at no extra cost. Delivery within 3 business days. Shall I formalize this quote?",
        },
        {
          role: "user",
          content:
            "Yes, please send the formal quote to our procurement at procurement@factory-example.com.",
        },
        {
          role: "assistant",
          content:
            "I've prepared quote QT-30451 and sent it to procurement@factory-example.com. It's valid for 14 days. Once you approve, we can schedule delivery. Anything else?",
        },
        {
          role: "user",
          content: "That's all for now. Thank you.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Quick turnaround on the quote",
        source: "customer",
      },
      links: [
        {
          url: "https://steelpoint-supply.example.com/quotes/QT-30451",
          title: "Quote QT-30451",
          connectorSlug: "steelpoint_catalog",
          resourceType: "quote",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      userIdentifier: "marek.z@factory-example.com",
      hoursAgo: 6,
      messages: [
        {
          role: "user",
          content:
            "Our production line is down because the hydraulic cylinders we ordered haven't arrived. Order SP-30089 was supposed to be here yesterday.",
        },
        {
          role: "assistant",
          content:
            "I understand this is critical for your production. Let me check order SP-30089 immediately.",
        },
        {
          role: "assistant",
          content:
            "I found your order — 4x Hydraulic Cylinder 100mm (1000mm stroke). It was dispatched on schedule but the courier reports a delay at the sorting hub. Current ETA is today before 16:00. I've flagged this as production-critical with our logistics team to ensure priority handling. I'm also creating an urgent support ticket so we can track this through to delivery.",
        },
        {
          role: "user",
          content:
            "We can't afford more delays. What if it doesn't arrive by 16:00?",
        },
        {
          role: "assistant",
          content:
            "If it doesn't arrive by 16:00, I'll arrange emergency courier delivery from our Warsaw warehouse — we have 2 units in stock there. That would arrive by 20:00 tonight. I'll call you at 15:30 with an update either way. What's the best number to reach you?",
        },
        {
          role: "user",
          content: "+48-22-555-0102. Thank you for taking this seriously.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Handled our urgent delivery issue professionally",
        source: "customer",
      },
      links: [
        {
          url: "https://steelpoint-supply.example.com/orders/SP-30089",
          title: "Order SP-30089",
          connectorSlug: "steelpoint_catalog",
          resourceType: "order",
        },
        {
          url: "https://steelpoint.zendesk.com/tickets/30156",
          title: "Ticket #30156 — Production-critical delivery",
          connectorSlug: "steelpoint_support",
          resourceType: "ticket",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "email",
      status: "completed",
      userIdentifier: "anna.w@construction-example.com",
      hoursAgo: 12,
      messages: [
        {
          role: "user",
          content:
            "We received Steel Pipe DN40 instead of DN50 on order SP-30067. We need the correct spec for our project — deadline is in 3 days.",
        },
        {
          role: "assistant",
          content:
            "I sincerely apologize for this specification error. I've verified order SP-30067 — you're right, DN50 was ordered but DN40 was shipped. Here's what we'll do:\n\n1. DN50 pipes ship today via express — delivery tomorrow by 12:00\n2. We'll arrange pickup of the DN40 pipes at no cost to you\n3. 5% discount applied to your next order as compensation\n\nI've created urgent ticket #30178 for tracking. Is this resolution acceptable?",
        },
        {
          role: "user",
          content:
            "Yes, tomorrow by noon works for our schedule. Please confirm when shipped.",
        },
        {
          role: "assistant",
          content:
            "Confirmed — shipment dispatched. Tracking number will be emailed within the hour. I'll personally follow up tomorrow morning to confirm delivery. Again, our apologies for the error.",
        },
      ],
      feedback: {
        rating: 1,
        comment: "Wrong spec shipped but resolution was fast",
        source: "customer",
      },
      links: [
        {
          url: "https://steelpoint-supply.example.com/orders/SP-30067",
          title: "Order SP-30067",
          connectorSlug: "steelpoint_catalog",
          resourceType: "order",
        },
        {
          url: "https://steelpoint.zendesk.com/tickets/30178",
          title: "Ticket #30178 — Wrong specification",
          connectorSlug: "steelpoint_support",
          resourceType: "ticket",
        },
      ],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      userIdentifier: "+48-22-555-0103",
      hoursAgo: 24,
      messages: [
        {
          role: "user",
          content: "I need to place a recurring order for welding consumables.",
        },
        {
          role: "assistant",
          content:
            "Of course. What products and quantities do you need, and how often?",
        },
        {
          role: "user",
          content:
            "50 spools of ER70S-6 in 1.0mm and 100 cutting discs (metal, 125mm). Every two weeks.",
        },
        {
          role: "assistant",
          content:
            "For a bi-weekly recurring order:\n- 50x Welding Wire ER70S-6 (1.0mm): €2,750\n- 100x Cutting Disc 125mm (Metal): €400\n- **Total per delivery: €3,150**\n\nWith a recurring order agreement, I can offer 8% discount, bringing it to €2,898 per delivery. Free shipping included. Shall I set this up?",
        },
        {
          role: "user",
          content: "Yes, starting next Monday. Bill to our account.",
        },
        {
          role: "assistant",
          content:
            "Done! Recurring order RO-30201 set up, first delivery scheduled for Monday. You'll receive an order confirmation email. The 8% discount applies to all recurring deliveries. Anything else?",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Great account management, recurring order was easy",
        source: "customer",
      },
      links: [
        {
          url: "https://steelpoint-supply.example.com/orders/RO-30201",
          title: "Recurring Order RO-30201",
          connectorSlug: "steelpoint_catalog",
          resourceType: "order",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "slack",
      status: "active",
      userIdentifier: "pawel@workshop-example.com",
      hoursAgo: 0,
      messages: [
        {
          role: "user",
          content:
            "Do you have the torque curve datasheet for the 2.2kW motor (2800rpm variant)?",
        },
        {
          role: "assistant",
          content:
            "Let me look that up for you. The Industrial Motor 2.2kW (2800rpm) has the following key specs:\n- Rated torque: 7.5 Nm\n- Breakdown torque: 22.5 Nm (3x rated)\n- Starting torque: 15 Nm (2x rated)\n\nI can send you the full datasheet PDF. Would you also like the dimensional drawing?",
        },
      ],
      feedback: null,
      links: [
        {
          url: "https://steelpoint-supply.example.com/products/industrial-motor-2.2kw",
          title: "Industrial Motor 2.2kW",
          connectorSlug: "steelpoint_catalog",
          resourceType: "product",
        },
      ],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "abandoned",
      userIdentifier: "+48-22-555-0105",
      hoursAgo: 48,
      messages: [
        {
          role: "user",
          content: "Hello?",
        },
        {
          role: "assistant",
          content:
            "Good day! Welcome to SteelPoint Supply. How can I help you?",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      userIdentifier: "finance@metalworks-example.com",
      hoursAgo: 96,
      messages: [
        {
          role: "user",
          content:
            "Invoice INV-2024-1847 references PO-4521 but our PO number was PO-4512. Can you correct this?",
        },
        {
          role: "assistant",
          content:
            "I apologize for the typo. I can see the discrepancy — invoice INV-2024-1847 should reference PO-4512 instead of PO-4521. I'm issuing a corrected invoice now. You'll receive it via email within the hour. I've also created ticket #30290 so our accounting team confirms the correction in our system.",
        },
        {
          role: "user",
          content:
            "Thank you. Please CC accounting@metalworks-example.com on the corrected invoice.",
        },
        {
          role: "assistant",
          content:
            "Noted — the corrected invoice will be sent to both your email and accounting@metalworks-example.com. Is there anything else?",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Invoice correction handled quickly",
        source: "customer",
      },
      links: [
        {
          url: "https://steelpoint.zendesk.com/tickets/30290",
          title: "Ticket #30290 — Invoice correction",
          connectorSlug: "steelpoint_support",
          resourceType: "ticket",
        },
      ],
    },
  ],

  firstNames: [
    "Tomasz",
    "Anna",
    "Marek",
    "Ewa",
    "Piotr",
    "Katarzyna",
    "Andrzej",
    "Marta",
    "Krzysztof",
    "Joanna",
    "Jan",
    "Magdalena",
    "Pawel",
    "Agnieszka",
    "Michal",
    "Klaus",
    "Hans",
    "Petra",
    "Stefan",
    "Ingrid",
  ],
  lastNames: [
    "Kowalski",
    "Nowak",
    "Wisniewski",
    "Wojcik",
    "Kaminski",
    "Lewandowski",
    "Zielinski",
    "Szymanski",
    "Wozniak",
    "Dabrowski",
    "Mueller",
    "Schmidt",
    "Schneider",
    "Fischer",
    "Weber",
    "Becker",
    "Hoffmann",
    "Wagner",
    "Richter",
    "Klein",
  ],
  emailDomains: [
    "factory.pl",
    "metalworks.de",
    "construction.eu",
    "industrial-group.com",
    "engineering.pl",
    "steelco.de",
    "machining.eu",
  ],
};

export default config;
