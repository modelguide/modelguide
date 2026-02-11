/**
 * Demo organization seed data.
 * Creates a polished demo org with agents, connectors, sessions, and feedback.
 */

import { encryptSecret, generateApiKey } from "@lib/crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import {
  type CatalogTool,
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  secrets,
  sessionFeedback,
  sessionLinks,
  sessionMessages,
  sessions,
  users,
} from "../schema";
import { generateDemoSessions } from "./demo-generated-sessions";

type SeedDb = PostgresJsDatabase<typeof schema>;

export async function seedDemoOrg(db: SeedDb) {
  console.log("\n--- Seeding Demo Organization ---");

  // 1. Create demo org
  const [org] = await db
    .insert(organizations)
    .values({
      name: "ModelGuide Demo",
      slug: "demo",
      settings: {
        timezone: "America/New_York",
        features: ["voice-agents", "chat-agents"],
      },
    })
    .onConflictDoNothing()
    .returning();

  const demoOrg =
    org ||
    (await db.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.slug, "demo"),
    }));

  if (!demoOrg) {
    console.error("Failed to create or find demo organization");
    return;
  }
  console.log("  Created/found demo org:", demoOrg.name);

  // 2. Create demo viewer user
  const [viewerUser] = await db
    .insert(users)
    .values({
      organizationId: demoOrg.id,
      email: "demo-viewer@modelguide.dev",
      name: "Demo Viewer",
      role: "viewer",
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const demoViewer =
    viewerUser ||
    (await db.query.users.findFirst({
      where: (u, { eq, and }) =>
        and(
          eq(u.organizationId, demoOrg.id),
          eq(u.email, "demo-viewer@modelguide.dev"),
        ),
    }));

  if (!demoViewer) {
    console.error("Failed to create or find demo viewer user");
    return;
  }
  console.log("  Created/found demo viewer:", demoViewer.email);

  // 3. Get Medusa catalog
  const medusaCatalog = await db.query.connectorsCatalog.findFirst({
    where: (cat, { eq }) => eq(cat.slug, "medusa"),
  });

  if (!medusaCatalog) {
    console.error("Medusa catalog not found — run full seed first");
    return;
  }

  // 4. Create connector
  const [conn] = await db
    .insert(connectors)
    .values({
      organizationId: demoOrg.id,
      connectorCatalogId: medusaCatalog.id,
      name: "TechStore",
      slug: "techstore",
      config: {
        baseUrl: "https://api.techstore-demo.example.com",
        publishableKey: "pk_demo_techstore_key",
      },
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const demoConnector =
    conn ||
    (await db.query.connectors.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.organizationId, demoOrg.id), eq(c.slug, "techstore")),
    }));

  if (!demoConnector) {
    console.error("Failed to create or find demo connector");
    return;
  }
  console.log("  Created/found connector:", demoConnector.name);

  // 5. Create secret for connector
  const encrypted = await encryptSecret("sk_demo_techstore_placeholder");
  await db
    .insert(secrets)
    .values({
      organizationId: demoOrg.id,
      name: "TechStore API Key",
      secretType: "api_key",
      encryptedValue: encrypted,
      ownerType: "connector",
      ownerId: demoConnector.id,
    })
    .onConflictDoNothing();
  console.log("  Created/found secret");

  // 6. Create connector tools from catalog
  if (medusaCatalog.tools && Array.isArray(medusaCatalog.tools)) {
    const toolValues = medusaCatalog.tools.map((tool: CatalogTool) => ({
      organizationId: demoOrg.id,
      connectorId: demoConnector.id,
      name: tool.name,
      slug: tool.name.toLowerCase().replace(/\s+/g, "_"),
      description: tool.description,
      toolSchema: tool.inputSchema,
      timeoutSeconds: tool.defaultTimeoutSeconds || 30,
      isActive: true,
    }));

    const insertedTools = await db
      .insert(connectorTools)
      .values(toolValues)
      .onConflictDoNothing()
      .returning();
    console.log(`  Created ${insertedTools.length} connector tools`);
  }

  // 7. Create 2 agents
  const agentDefs = [
    {
      name: "TechStore Voice Assistant",
      slug: "techstore-voice-assistant",
      description:
        "Handles phone orders, product inquiries, and order status checks via voice",
    },
    {
      name: "TechStore Chat Bot",
      slug: "techstore-chat-bot",
      description:
        "Web chat assistant for browsing products, placing orders, and tracking deliveries",
    },
  ];

  const createdAgents: { id: string; name: string }[] = [];
  for (const def of agentDefs) {
    const [agent] = await db
      .insert(agents)
      .values({
        organizationId: demoOrg.id,
        name: def.name,
        slug: def.slug,
        description: def.description,
        agentType: "voice",
        isActive: true,
        createdBy: demoViewer.id,
      })
      .onConflictDoNothing()
      .returning();

    const found =
      agent ||
      (await db.query.agents.findFirst({
        where: (a, { eq, and }) =>
          and(eq(a.organizationId, demoOrg.id), eq(a.name, def.name)),
      }));

    if (found) {
      createdAgents.push({ id: found.id, name: found.name });
      console.log("  Created/found agent:", found.name);
    }
  }

  // 8. Generate API keys for agents
  for (const agent of createdAgents) {
    const { key, hash, prefix } = generateApiKey();
    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        organizationId: demoOrg.id,
        agentId: agent.id,
        name: `${agent.name} Key`,
        keyHash: hash,
        keyPrefix: prefix,
        isActive: true,
        createdBy: demoViewer.id,
      })
      .onConflictDoNothing()
      .returning();
    if (apiKey) {
      console.log(`  Created API key for ${agent.name}: ${key}`);
    }
  }

  // 9. Link tools to agents
  const allTools = await db.query.connectorTools.findMany({
    where: (t, { eq }) => eq(t.connectorId, demoConnector.id),
  });

  for (const agent of createdAgents) {
    const linkValues = allTools.map((tool) => ({
      agentId: agent.id,
      connectorToolId: tool.id,
      isEnabled: true,
      requiresConfirmation:
        tool.name.toLowerCase().includes("confirm") ||
        tool.name.toLowerCase().includes("cancel") ||
        tool.name.toLowerCase().includes("complete"),
    }));

    await db
      .insert(agentConnectorTools)
      .values(linkValues)
      .onConflictDoNothing();
  }
  console.log("  Linked tools to agents");

  // 10. Create demo sessions with messages and feedback
  if (createdAgents.length === 0) return;

  const demoSessions = [
    {
      agent: 0,
      channel: "voice" as const,
      status: "completed" as const,
      userIdentifier: "+1-555-0101",
      hoursAgo: 2,
      messages: [
        {
          role: "user" as const,
          content: "Hi, I'd like to check the status of my order.",
        },
        {
          role: "assistant" as const,
          content:
            "Of course! Could you give me your order number or the email you used to place it?",
        },
        {
          role: "user" as const,
          content: "It's order TK-20241. Email is sarah@example.com.",
        },
        {
          role: "assistant" as const,
          content:
            "I found your order TK-20241. It shipped yesterday and is currently in transit. The estimated delivery is tomorrow between 2-6 PM. Would you like me to send you the tracking link?",
        },
        { role: "user" as const, content: "Yes, please send it." },
        {
          role: "assistant" as const,
          content:
            "Done! I've sent the tracking link to sarah@example.com. Is there anything else I can help with?",
        },
        { role: "user" as const, content: "No, that's all. Thanks!" },
        {
          role: "assistant" as const,
          content: "You're welcome! Have a great day.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Quick and helpful!",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/orders/TK-20241",
          title: "Order TK-20241",
          connectorSlug: "techstore",
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
      agent: 0,
      channel: "voice" as const,
      status: "completed" as const,
      userIdentifier: "+1-555-0102",
      hoursAgo: 5,
      messages: [
        {
          role: "user" as const,
          content: "I need to return a laptop I bought last week.",
        },
        {
          role: "assistant" as const,
          content: "I can help with that. Can you share your order number?",
        },
        { role: "user" as const, content: "TK-20198." },
        {
          role: "assistant" as const,
          content:
            "I see order TK-20198 — a ProBook 15 laptop purchased 6 days ago. You're within the 30-day return window. May I ask the reason for the return?",
        },
        { role: "user" as const, content: "The battery drains too fast." },
        {
          role: "assistant" as const,
          content:
            "I understand. I've initiated a return for you. You'll receive a prepaid shipping label at your email. Once we receive the laptop, your refund will be processed within 3-5 business days.",
        },
        { role: "user" as const, content: "Perfect, thank you." },
      ],
      feedback: {
        rating: 2,
        comment: "Return process was smooth",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/orders/TK-20198",
          title: "Order TK-20198",
          connectorSlug: "techstore",
          resourceType: "order",
        },
        {
          url: "https://techstore-demo.example.com/products/probook-15",
          title: "ProBook 15 Laptop",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/returns/RET-4821",
          title: "Return RET-4821",
          connectorSlug: "techstore",
          resourceType: "return",
        },
      ],
    },
    {
      agent: 1,
      channel: "web" as const,
      status: "completed" as const,
      userIdentifier: "mike@example.com",
      hoursAgo: 8,
      messages: [
        {
          role: "user" as const,
          content: "What wireless headphones do you recommend under $200?",
        },
        {
          role: "assistant" as const,
          content:
            "Great question! Here are our top picks under $200:\n\n1. **SoundMax Pro** — $179, noise-cancelling, 30hr battery\n2. **AudioElite Wireless** — $149, great bass, 25hr battery\n3. **ClearTone ANC** — $129, lightweight, 20hr battery\n\nWould you like details on any of these?",
        },
        {
          role: "user" as const,
          content: "Tell me more about the SoundMax Pro",
        },
        {
          role: "assistant" as const,
          content:
            "The SoundMax Pro features:\n- Active noise cancellation with transparency mode\n- 30-hour battery life\n- Bluetooth 5.3 with multipoint connection\n- Foldable design with carrying case\n- Available in black, silver, and midnight blue\n\nIt's our best seller in this range. Want me to add it to your cart?",
        },
        {
          role: "user" as const,
          content: "Yes, add the midnight blue one please",
        },
        {
          role: "assistant" as const,
          content:
            "Added SoundMax Pro (Midnight Blue) to your cart — $179. Would you like to proceed to checkout or keep browsing?",
        },
        { role: "user" as const, content: "I'll checkout" },
        {
          role: "assistant" as const,
          content:
            "Here's your cart summary:\n- SoundMax Pro (Midnight Blue): $179\n- Shipping: Free\n- **Total: $179**\n\nShall I proceed with checkout?",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Found exactly what I needed",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/products/soundmax-pro",
          title: "SoundMax Pro Headphones",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/products/audioelite-wireless",
          title: "AudioElite Wireless",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/products/cleartone-anc",
          title: "ClearTone ANC",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/cart/session/CS-8812",
          title: "Cart CS-8812",
          connectorSlug: "techstore",
          resourceType: "cart",
        },
      ],
    },
    {
      agent: 1,
      channel: "web" as const,
      status: "completed" as const,
      userIdentifier: "lisa@example.com",
      hoursAgo: 12,
      messages: [
        {
          role: "user" as const,
          content: "My order arrived but the screen has a crack",
        },
        {
          role: "assistant" as const,
          content:
            "I'm sorry to hear that! That's definitely not the experience we want. Let me help you right away. Can you share your order number?",
        },
        { role: "user" as const, content: "TK-20185" },
        {
          role: "assistant" as const,
          content:
            "I found your order — a UltraView 27\" Monitor. Since it arrived damaged, we'll arrange a free replacement. I've flagged this as a shipping damage claim. A replacement will ship within 24 hours with express delivery. You'll receive a return label for the damaged unit — no rush on sending it back.",
        },
        { role: "user" as const, content: "Oh wow, that was fast. Thank you!" },
      ],
      feedback: {
        rating: 2,
        comment: "Excellent service for a damaged item",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/orders/TK-20185",
          title: "Order TK-20185",
          connectorSlug: "techstore",
          resourceType: "order",
        },
        {
          url: "https://techstore-demo.example.com/products/ultraview-27",
          title: 'UltraView 27" Monitor',
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/claims/DMG-1190",
          title: "Damage Claim DMG-1190",
          connectorSlug: "techstore",
          resourceType: "claim",
        },
      ],
    },
    {
      agent: 0,
      channel: "voice" as const,
      status: "active" as const,
      userIdentifier: "+1-555-0105",
      hoursAgo: 0,
      messages: [
        {
          role: "user" as const,
          content:
            "Hi, I'm looking for a gift for my daughter. She's into gaming.",
        },
        {
          role: "assistant" as const,
          content:
            "I'd love to help! What's your budget range, and do you know if she prefers PC or console gaming?",
        },
        {
          role: "user" as const,
          content: "Around $300, and she plays on PC mostly.",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agent: 1,
      channel: "web" as const,
      status: "abandoned" as const,
      userIdentifier: "anonymous-user-7291",
      hoursAgo: 24,
      messages: [
        { role: "user" as const, content: "Do you ship internationally?" },
        {
          role: "assistant" as const,
          content:
            "Yes! We ship to over 40 countries. Shipping rates and delivery times vary by destination. Which country would you like to ship to?",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agent: 0,
      channel: "voice" as const,
      status: "completed" as const,
      userIdentifier: "+1-555-0107",
      hoursAgo: 36,
      messages: [
        {
          role: "user" as const,
          content: "I want to cancel my order TK-20210.",
        },
        {
          role: "assistant" as const,
          content:
            "Let me check that order for you... I see order TK-20210 placed 2 hours ago. It hasn't shipped yet, so I can cancel it. Shall I proceed?",
        },
        { role: "user" as const, content: "Yes, please cancel it." },
        {
          role: "assistant" as const,
          content:
            "Done! Order TK-20210 has been cancelled. Your refund of $249 will appear in 1-2 business days. Is there anything else?",
        },
      ],
      feedback: {
        rating: 1,
        comment: "Wanted to keep the item but price dropped elsewhere",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/orders/TK-20210",
          title: "Order TK-20210 (Cancelled)",
          connectorSlug: "techstore",
          resourceType: "order",
        },
      ],
    },
    {
      agent: 1,
      channel: "web" as const,
      status: "completed" as const,
      userIdentifier: "james@example.com",
      hoursAgo: 48,
      messages: [
        {
          role: "user" as const,
          content:
            "Can I get a bulk discount? I need 50 USB-C cables for our office.",
        },
        {
          role: "assistant" as const,
          content:
            "Absolutely! For orders of 50+ units, we offer tiered pricing:\n- 50-99 units: 15% off\n- 100-249 units: 20% off\n- 250+ units: 25% off\n\nOur USB-C cables are $12.99 each. With 50 units at 15% off, that would be $552.08 total ($11.04 each). Would you like to proceed?",
        },
        { role: "user" as const, content: "That works, let's do 50." },
        {
          role: "assistant" as const,
          content:
            "I've added 50 USB-C cables to your cart with the 15% bulk discount applied. Total: $552.08 with free shipping. Would you like to proceed to checkout?",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Great bulk pricing",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/products/usb-c-cable",
          title: "USB-C Cable",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/cart/session/CS-9044",
          title: "Bulk Order Cart",
          connectorSlug: "techstore",
          resourceType: "cart",
        },
      ],
    },
    {
      agent: 0,
      channel: "voice" as const,
      status: "completed" as const,
      userIdentifier: "+1-555-0109",
      hoursAgo: 72,
      messages: [
        {
          role: "user" as const,
          content: "What's your warranty policy on laptops?",
        },
        {
          role: "assistant" as const,
          content:
            "All our laptops come with a standard 1-year manufacturer warranty covering hardware defects. We also offer extended warranty plans:\n- 2-year plan: $99\n- 3-year plan: $149\n\nBoth include accidental damage protection. Would you like to add a warranty to an existing purchase, or are you looking to buy a new laptop?",
        },
        {
          role: "user" as const,
          content: "I already bought one last month. Can I still add warranty?",
        },
        {
          role: "assistant" as const,
          content:
            "Yes, you can add an extended warranty within 30 days of purchase. What's your order number? I'll check the details and help you add it.",
        },
        { role: "user" as const, content: "TK-20150" },
        {
          role: "assistant" as const,
          content:
            "Found it — ProBook 15 purchased 22 days ago. You're still within the 30-day window. Which plan would you prefer: 2-year ($99) or 3-year ($149)?",
        },
        { role: "user" as const, content: "The 3-year plan please" },
        {
          role: "assistant" as const,
          content:
            "I've added the 3-year extended warranty to your ProBook 15. $149 will be charged to your original payment method. Your warranty now extends to January 2028. A confirmation email is on its way!",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Very informative and helpful",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/orders/TK-20150",
          title: "Order TK-20150",
          connectorSlug: "techstore",
          resourceType: "order",
        },
        {
          url: "https://techstore-demo.example.com/products/probook-15",
          title: "ProBook 15 Laptop",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/warranty/WRN-3350",
          title: "Warranty WRN-3350 (3yr)",
          connectorSlug: "techstore",
          resourceType: "warranty",
        },
      ],
    },
    {
      agent: 1,
      channel: "web" as const,
      status: "completed" as const,
      userIdentifier: "emma@example.com",
      hoursAgo: 96,
      messages: [
        {
          role: "user" as const,
          content: "I got the wrong color. I ordered white but received black.",
        },
        {
          role: "assistant" as const,
          content:
            "I apologize for the mix-up! Let me look into this. What's your order number?",
        },
        { role: "user" as const, content: "TK-20175" },
        {
          role: "assistant" as const,
          content:
            "I see the issue — order TK-20175, SoundMax Pro in White. I'll arrange an exchange right away. A white unit will ship today with express delivery (1-2 days). You'll get a return label for the black unit. No need to wait for us to receive it first.",
        },
        { role: "user" as const, content: "Thanks for the quick resolution!" },
      ],
      feedback: {
        rating: 2,
        comment: "Fast exchange, no hassle",
        source: "customer" as const,
      },
      links: [
        {
          url: "https://techstore-demo.example.com/orders/TK-20175",
          title: "Order TK-20175",
          connectorSlug: "techstore",
          resourceType: "order",
        },
        {
          url: "https://techstore-demo.example.com/products/soundmax-pro",
          title: "SoundMax Pro Headphones",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/exchanges/EXC-7720",
          title: "Exchange EXC-7720",
          connectorSlug: "techstore",
          resourceType: "exchange",
        },
      ],
    },
    {
      agent: 0,
      channel: "voice" as const,
      status: "abandoned" as const,
      userIdentifier: "+1-555-0111",
      hoursAgo: 120,
      messages: [
        { role: "user" as const, content: "Hello?" },
        {
          role: "assistant" as const,
          content: "Hi! Welcome to TechStore. How can I help you today?",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agent: 1,
      channel: "web" as const,
      status: "active" as const,
      userIdentifier: "alex@example.com",
      hoursAgo: 1,
      messages: [
        {
          role: "user" as const,
          content:
            "I'm building a home studio. What monitors and audio equipment do you recommend?",
        },
        {
          role: "assistant" as const,
          content:
            'Great project! For a home studio, I\'d recommend:\n\n**Monitors:**\n- UltraView 27" 4K — $449 (color-accurate, great for editing)\n- DualView 32" Curved — $599 (immersive, wide color gamut)\n\n**Audio:**\n- StudioPro USB Microphone — $129\n- SoundMax Pro Headphones — $179\n\nWould you like to explore any of these in more detail?',
        },
      ],
      feedback: null,
      links: [
        {
          url: "https://techstore-demo.example.com/products/ultraview-27-4k",
          title: 'UltraView 27" 4K Monitor',
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/products/dualview-32-curved",
          title: 'DualView 32" Curved',
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/products/studiopro-usb-mic",
          title: "StudioPro USB Microphone",
          connectorSlug: "techstore",
          resourceType: "product",
        },
        {
          url: "https://techstore-demo.example.com/products/soundmax-pro",
          title: "SoundMax Pro Headphones",
          connectorSlug: "techstore",
          resourceType: "product",
        },
      ],
    },
  ];

  const now = Date.now();

  for (const sessionDef of demoSessions) {
    const agentId = createdAgents[sessionDef.agent]?.id;
    if (!agentId) continue;

    const startedAt = new Date(now - sessionDef.hoursAgo * 60 * 60 * 1000);
    const endedAt =
      sessionDef.status !== "active"
        ? new Date(
            startedAt.getTime() +
              (5 + Math.floor(Math.random() * 10)) * 60 * 1000,
          )
        : null;

    const [session] = await db
      .insert(sessions)
      .values({
        organizationId: demoOrg.id,
        agentId,
        channelType: sessionDef.channel,
        status: sessionDef.status,
        userIdentifier: sessionDef.userIdentifier,
        startedAt,
        endedAt,
      })
      .onConflictDoNothing()
      .returning();

    if (!session) continue;

    // Insert messages
    const messageValues = sessionDef.messages.map((msg, idx) => ({
      sessionId: session.id,
      role: msg.role,
      content: msg.content,
      createdAt: new Date(startedAt.getTime() + idx * 15000),
      occurredAt: new Date(startedAt.getTime() + idx * 15000),
    }));

    await db
      .insert(sessionMessages)
      .values(messageValues)
      .onConflictDoNothing();

    // Insert feedback
    if (sessionDef.feedback) {
      await db
        .insert(sessionFeedback)
        .values({
          sessionId: session.id,
          rating: sessionDef.feedback.rating,
          comment: sessionDef.feedback.comment,
          feedbackSource: sessionDef.feedback.source,
        })
        .onConflictDoNothing();
    }

    // Insert links
    if (sessionDef.links.length > 0) {
      await db
        .insert(sessionLinks)
        .values(
          sessionDef.links.map((link) => ({
            sessionId: session.id,
            url: link.url,
            title: link.title,
            connectorSlug: link.connectorSlug,
            resourceType: link.resourceType,
          })),
        )
        .onConflictDoNothing();
    }
  }

  console.log(`  Created ${demoSessions.length} handwritten demo sessions`);

  // Generate ~300 additional sessions with realistic variety
  await generateDemoSessions(db, demoOrg.id, createdAgents);

  console.log("  Demo org seed completed!");
}
