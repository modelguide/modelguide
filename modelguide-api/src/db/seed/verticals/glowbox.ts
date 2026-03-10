/**
 * GlowBox Beauty — Retail / Beauty industry vertical.
 * Use case: "Where is my order?", product recommendations, returns.
 * Channel mix: web-dominant (40% web) — typical for beauty e-commerce.
 */

import type { OrgVerticalConfig } from "./types";

const config: OrgVerticalConfig = {
  org: {
    name: "GlowBox Beauty",
    slug: "glowbox",
    timezone: "America/New_York",
    features: ["voice-agents", "chat-agents"],
    demoEnabled: true,
  },

  users: {
    admin: {
      email: "delivered+admin-glowbox@resend.dev",
      name: "Rachel Kim",
    },
    support: {
      email: "delivered+support-glowbox@resend.dev",
      name: "Maya Patel",
    },
    viewer: {
      email: "demo-viewer-glowbox@modelguide.dev",
      name: "Demo Viewer",
    },
    inactive: {
      email: "delivered+inactive-glowbox@resend.dev",
      name: "Former Employee",
    },
  },

  ecommerce: {
    connectorName: "GlowBox Store",
    connectorSlug: "glowbox_store",
    config: {
      baseUrl: "https://api.glowbox-beauty.example.com",
      publishableKey: "pk_glowbox_placeholder",
    },
  },

  helpdesk: {
    connectorName: "GlowBox Support",
    connectorSlug: "glowbox_support",
    config: {
      subdomain: "glowbox",
      email: "support@glowbox-beauty.example.com",
    },
  },

  agents: [
    {
      name: "GlowBox Voice Concierge",
      slug: "glowbox-voice-concierge",
      description:
        "Handles phone orders, product recommendations, order status, and returns for beauty customers",
    },
    {
      name: "GlowBox Chat Assistant",
      slug: "glowbox-chat-assistant",
      description:
        "Web chat for browsing products, skincare routines, placing orders, and tracking deliveries",
    },
  ],

  products: [
    {
      name: "CeraVe Hydrating Cleanser",
      price: 16,
      variants: ["200ml", "473ml"],
      category: "skincare",
    },
    {
      name: "The Ordinary Niacinamide 10%",
      price: 6,
      variants: ["30ml", "60ml"],
      category: "serums",
    },
    {
      name: "La Roche-Posay SPF 50",
      price: 35,
      variants: ["50ml", "100ml"],
      category: "sunscreen",
    },
    {
      name: "MAC Ruby Woo Lipstick",
      price: 23,
      variants: ["Matte", "Retro Matte"],
      category: "makeup",
    },
    {
      name: "Olaplex No. 3 Treatment",
      price: 30,
      variants: ["100ml", "250ml"],
      category: "haircare",
    },
    {
      name: "Glossier Cloud Paint",
      price: 20,
      variants: ["Puff", "Beam", "Storm", "Dusk"],
      category: "makeup",
    },
    {
      name: "Paula's Choice BHA Exfoliant",
      price: 35,
      variants: ["30ml", "118ml"],
      category: "skincare",
    },
    {
      name: "Dyson Airwrap",
      price: 599,
      variants: ["Complete", "Multi-Styler"],
      category: "tools",
    },
  ],

  ticketTemplates: [
    {
      subject: "Package arrived damaged — serum bottle cracked",
      priority: "high",
      type: "problem",
      tags: ["shipping", "damage"],
    },
    {
      subject: "Allergic reaction to face cream",
      priority: "urgent",
      type: "problem",
      tags: ["safety", "health"],
    },
    {
      subject: "Received wrong shade of lipstick",
      priority: "normal",
      type: "incident",
      tags: ["wrong-item", "exchange"],
    },
    {
      subject: "Need skincare routine recommendation",
      priority: "low",
      type: "question",
      tags: ["advice", "skincare"],
    },
    {
      subject: "Refund not yet processed after 10 days",
      priority: "high",
      type: "problem",
      tags: ["billing", "refund"],
    },
    {
      subject: "Cancel beauty box subscription",
      priority: "normal",
      type: "task",
      tags: ["subscription", "cancellation"],
    },
  ],

  generalQA: [
    {
      q: "Do you offer free shipping?",
      a: "Yes! Free standard shipping on all orders over $35. Express shipping (1-2 days) is available for $7.99.",
    },
    {
      q: "What's your return policy on opened products?",
      a: "We accept returns within 30 days, even on opened products. Just make sure you've used less than 50% of the product. Returns are free — we'll email you a prepaid label.",
    },
    {
      q: "Are your products cruelty-free?",
      a: "Many of our brands are cruelty-free and certified by Leaping Bunny. You can filter by cruelty-free on our website. Let me know if you'd like recommendations!",
    },
    {
      q: "Do you have a loyalty program?",
      a: "Yes! GlowRewards gives you 1 point per dollar spent. 100 points = $5 off. Plus, members get early access to new launches and exclusive samples.",
    },
    {
      q: "Can I get product samples before buying?",
      a: "We include 2 free samples with every order! You can also purchase our Discovery Kit ($15) which includes trial sizes of 5 bestsellers.",
    },
    {
      q: "What payment methods do you accept?",
      a: "We accept all major credit cards, PayPal, Apple Pay, Google Pay, and Klarna for buy-now-pay-later installments.",
    },
  ],

  orderPrefix: "GB-",
  ticketIdRange: [10000, 19999],
  baseUrl: "https://glowbox-beauty.example.com",
  helpdeskBaseUrl: "https://glowbox.zendesk.com",

  scenarioWeights: [
    { value: "product_inquiry", weight: 25 },
    { value: "purchase_flow", weight: 20 },
    { value: "order_status", weight: 15 },
    { value: "return_exchange", weight: 10 },
    { value: "ticket_lookup", weight: 10 },
    { value: "ticket_creation", weight: 8 },
    { value: "ticket_escalation", weight: 5 },
    { value: "general_question", weight: 7 },
  ],

  channelWeights: [
    { value: "web", weight: 40 },
    { value: "voice", weight: 15 },
    { value: "widget", weight: 15 },
    { value: "whatsapp", weight: 12 },
    { value: "email", weight: 10 },
    { value: "sms", weight: 5 },
    { value: "slack", weight: 2 },
    { value: "api", weight: 1 },
  ],

  feedback: {
    positiveCustomer: [
      "Love my order, thanks!",
      "Super fast shipping!",
      "Great product recommendation",
      "Exactly what my skin needed",
      "The agent really knew their stuff about skincare",
      "Smooth checkout experience",
      "Impressed with the help",
      "Will definitely order again",
    ],
    negativeCustomer: [
      "Product didn't match the description",
      "Shipping took too long",
      "Wrong shade sent",
      "Packaging was damaged",
      "Expected more samples",
      "Return process was confusing",
    ],
    positiveSupport: [
      "Good product knowledge displayed",
      "Handled allergy concern with appropriate urgency",
      "Clean upsell of complementary products",
      "Followed return protocol correctly",
      "Empathetic tone throughout",
    ],
    negativeSupport: [
      "Missed opportunity to suggest skincare routine",
      "Should have flagged allergy report for safety team",
      "Could be more concise",
      "Didn't confirm shade preference before checkout",
    ],
  },

  handwrittenSessions: [
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      customer: { phone: "+15550201" },
      hoursAgo: 2,
      messages: [
        { role: "user", content: "Hi, I want to check on my order." },
        {
          role: "assistant",
          content:
            "Of course! I'd be happy to help. Could you give me your order number or the email address you used?",
        },
        {
          role: "user",
          content: "It's GB-30142. Email is sarah.j@example.com.",
        },
        {
          role: "assistant",
          content:
            "I found your order GB-30142 — the CeraVe Hydrating Cleanser and The Ordinary Niacinamide serum. It shipped yesterday and is currently in transit. Expected delivery is tomorrow between 2-6 PM. Would you like me to send you the tracking link?",
        },
        { role: "user", content: "Yes please!" },
        {
          role: "assistant",
          content:
            "Done! I've sent the tracking link to sarah.j@example.com. Is there anything else I can help with?",
        },
        { role: "user", content: "No, that's perfect. Thank you!" },
        {
          role: "assistant",
          content: "You're welcome! Enjoy your new skincare products.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Quick and helpful!",
        source: "customer",
      },
      links: [
        {
          url: "https://glowbox-beauty.example.com/orders/GB-30142",
          title: "Order GB-30142",
          connectorSlug: "glowbox_store",
          resourceType: "order",
        },
        {
          url: "https://tracking.example.com/pkg/1Z999AA10123456784",
          title: "Shipment Tracking",
          resourceType: "tracking",
        },
      ],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      customer: { phone: "+15550202" },
      hoursAgo: 5,
      messages: [
        {
          role: "user",
          content: "I need to return a moisturizer I bought last week.",
        },
        {
          role: "assistant",
          content: "I can help with that. Can you share your order number?",
        },
        { role: "user", content: "GB-30098." },
        {
          role: "assistant",
          content:
            "I see order GB-30098 — La Roche-Posay SPF 50 purchased 6 days ago. You're within the 30-day return window. May I ask the reason for the return?",
        },
        {
          role: "user",
          content: "It made my skin feel greasy. Not the right formula for me.",
        },
        {
          role: "assistant",
          content:
            "I understand — sunscreens can be tricky with different skin types. I've initiated a return for you. You'll receive a prepaid shipping label at your email. Once we receive it, your refund will be processed within 3-5 business days. Would you like me to suggest an alternative SPF that works better for oily skin?",
        },
        {
          role: "user",
          content: "Sure, what do you recommend?",
        },
        {
          role: "assistant",
          content:
            "Our Paula's Choice BHA Exfoliant actually has SPF properties and works great for oily skin. Many customers with similar concerns love it. I can add it to your cart if you'd like!",
        },
        {
          role: "user",
          content: "I'll think about it, but thanks for the suggestion.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Return process was smooth and the recommendation was helpful",
        source: "customer",
      },
      links: [
        {
          url: "https://glowbox-beauty.example.com/orders/GB-30098",
          title: "Order GB-30098",
          connectorSlug: "glowbox_store",
          resourceType: "order",
        },
        {
          url: "https://glowbox-beauty.example.com/returns/RET-4821",
          title: "Return RET-4821",
          connectorSlug: "glowbox_store",
          resourceType: "return",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      customer: { name: "Olivia W.", email: "olivia.w@example.com" },
      hoursAgo: 8,
      messages: [
        {
          role: "user",
          content:
            "I have combination skin and I'm looking for a good serum. What do you recommend under $30?",
        },
        {
          role: "assistant",
          content:
            "Great question! For combination skin under $30, here are my top picks:\n\n1. **The Ordinary Niacinamide 10%** — $6, minimizes pores, balances oil\n2. **Paula's Choice BHA Exfoliant** — $35 (just over budget but worth it!), unclogs pores\n3. **Glossier Cloud Paint** — $20, lightweight hydration with a dewy finish\n\nThe Niacinamide is our bestseller for combination skin. Would you like more details on any of these?",
        },
        {
          role: "user",
          content: "Tell me more about the Niacinamide",
        },
        {
          role: "assistant",
          content:
            "The Ordinary Niacinamide 10% + Zinc 1% is a lightweight serum that:\n- Reduces blemishes and congestion\n- Balances oil production (perfect for your T-zone)\n- Minimizes pore appearance\n- Available in 30ml ($6) and 60ml ($10)\n\nIt's water-based so it layers beautifully under moisturizer and SPF. Want me to add it to your cart?",
        },
        { role: "user", content: "Yes, the 60ml please!" },
        {
          role: "assistant",
          content:
            "Added The Ordinary Niacinamide 10% (60ml) to your cart — $10. Free shipping since we're running a promo this week! Shall I proceed to checkout?",
        },
        { role: "user", content: "Yes, let's do it." },
      ],
      feedback: {
        rating: 2,
        comment: "Found exactly what I needed for my skin type",
        source: "customer",
      },
      links: [
        {
          url: "https://glowbox-beauty.example.com/products/ordinary-niacinamide",
          title: "The Ordinary Niacinamide 10%",
          connectorSlug: "glowbox_store",
          resourceType: "product",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      customer: { name: "Emma T.", email: "emma.t@example.com" },
      hoursAgo: 12,
      messages: [
        {
          role: "user",
          content:
            "My order arrived but the serum bottle was cracked and leaked everywhere.",
        },
        {
          role: "assistant",
          content:
            "Oh no, I'm so sorry about that! That's definitely not the experience we want. Let me help you right away. Can you share your order number?",
        },
        { role: "user", content: "GB-30075" },
        {
          role: "assistant",
          content:
            "I found your order — The Ordinary Niacinamide 10%. Since it arrived damaged, we'll send a free replacement right away. It'll ship today with express delivery (1-2 days). No need to return the damaged one. I've also created a support ticket so our shipping team can investigate the packaging.",
        },
        {
          role: "user",
          content: "That's really nice of you, thank you!",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Excellent handling of a damaged shipment",
        source: "customer",
      },
      links: [
        {
          url: "https://glowbox-beauty.example.com/orders/GB-30075",
          title: "Order GB-30075",
          connectorSlug: "glowbox_store",
          resourceType: "order",
        },
        {
          url: "https://glowbox.zendesk.com/tickets/10234",
          title: "Ticket #10234 — Damaged shipment",
          connectorSlug: "glowbox_support",
          resourceType: "ticket",
        },
      ],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "active",
      customer: { phone: "+15550205" },
      hoursAgo: 0,
      messages: [
        {
          role: "user",
          content:
            "Hi, I'm looking for a gift for my mom. She's into skincare.",
        },
        {
          role: "assistant",
          content:
            "I'd love to help! What's your budget, and does she have any particular skin concerns?",
        },
        {
          role: "user",
          content: "Around $50-80, and she has dry skin.",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "abandoned",
      customer: { name: "anon-visitor-3891" },
      hoursAgo: 24,
      messages: [
        {
          role: "user",
          content: "Do you ship to Canada?",
        },
        {
          role: "assistant",
          content:
            "Yes! We ship to Canada. Standard shipping is $9.99 CAD with delivery in 5-7 business days. Free shipping on orders over $75 CAD. Which province would you like to ship to?",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      customer: { phone: "+15550207" },
      hoursAgo: 48,
      messages: [
        {
          role: "user",
          content:
            "I had an allergic reaction to a face cream I bought from you.",
        },
        {
          role: "assistant",
          content:
            "I'm so sorry to hear that. Your health is our top priority. Can you tell me which product it was and what symptoms you experienced?",
        },
        {
          role: "user",
          content:
            "It was the Glossier Cloud Paint in Puff. My cheeks got red and itchy.",
        },
        {
          role: "assistant",
          content:
            "Thank you for letting us know. I've flagged this with our safety team right away. For immediate relief, please stop using the product and consider a gentle antihistamine. I'm processing a full refund for you now — no need to return the product. Our safety team will follow up within 24 hours with more guidance. Is there anything else I can do for you right now?",
        },
        {
          role: "user",
          content: "No, thank you for taking it seriously.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Took my allergy concern very seriously",
        source: "customer",
      },
      links: [
        {
          url: "https://glowbox.zendesk.com/tickets/10189",
          title: "Ticket #10189 — Allergic reaction report",
          connectorSlug: "glowbox_support",
          resourceType: "ticket",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      customer: { name: "James H.", email: "james.h@example.com" },
      hoursAgo: 72,
      messages: [
        {
          role: "user",
          content:
            "Can I get a bulk discount? I run a small salon and need 20 units of the CeraVe cleanser.",
        },
        {
          role: "assistant",
          content:
            "Absolutely! For bulk orders of 10+ units, we offer tiered pricing:\n- 10-24 units: 15% off\n- 25-49 units: 20% off\n- 50+ units: 25% off\n\nCeraVe Hydrating Cleanser (473ml) is $16 each. With 20 units at 15% off, that's $272 total ($13.60 each). Would you like to proceed?",
        },
        {
          role: "user",
          content: "That works, let's do 20 of the 473ml.",
        },
        {
          role: "assistant",
          content:
            "I've added 20x CeraVe Hydrating Cleanser (473ml) to your cart with the 15% salon discount. Total: $272 with free shipping. Shall I proceed to checkout?",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Great bulk pricing for my salon",
        source: "customer",
      },
      links: [
        {
          url: "https://glowbox-beauty.example.com/products/cerave-hydrating-cleanser",
          title: "CeraVe Hydrating Cleanser",
          connectorSlug: "glowbox_store",
          resourceType: "product",
        },
      ],
    },
  ],
};

export default config;
