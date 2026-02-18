/**
 * Parameterized session generator.
 * Produces ~300 sessions per org with realistic conversations,
 * Medusa + Zendesk tool calls, and feedback.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import {
  sessionFeedback,
  sessionLinks,
  sessionMessages,
  sessions,
} from "../schema";
import type {
  ChannelType,
  OrgVerticalConfig,
  Product,
  Scenario,
  Weighted,
} from "./verticals/types";

type SeedDb = PostgresJsDatabase<typeof schema>;

// ============================================================================
// Random helpers
// ============================================================================

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick() called on empty array");
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick<T>(items: readonly Weighted<T>[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_COUNT = 300;
const DAYS_BACK = 45;

/** Channels routed to the first (voice/phone) agent */
const VOICE_CHANNELS = new Set<ChannelType>(["voice", "sms", "whatsapp"]);

/** Hourly weights — peak 10–18 */
const HOUR_WEIGHTS = [
  1, 1, 1, 1, 1, 2, 3, 5, 7, 9, 10, 10, 9, 10, 10, 9, 8, 7, 5, 4, 3, 2, 1, 1,
];

// ============================================================================
// Default name pools (overridden by config)
// ============================================================================

const DEFAULT_FIRST_NAMES = [
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "James",
  "Sophia",
  "Lucas",
  "Mia",
  "Ethan",
  "Harper",
  "Mason",
  "Ella",
  "Logan",
  "Aria",
  "Alex",
  "Chloe",
  "Ben",
  "Lily",
  "Jack",
  "Zoe",
  "Ryan",
  "Grace",
  "Dan",
  "Nora",
];

const DEFAULT_LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Wilson",
  "Taylor",
  "Anderson",
  "Thomas",
  "Jackson",
  "White",
  "Harris",
  "Martin",
  "Clark",
  "Lewis",
  "Lee",
  "Walker",
];

const DEFAULT_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "company.co",
  "work.io",
];

// ============================================================================
// User identifier generation
// ============================================================================

function makeEmail(config: OrgVerticalConfig): string {
  const first = pick(config.firstNames ?? DEFAULT_FIRST_NAMES).toLowerCase();
  const last = pick(config.lastNames ?? DEFAULT_LAST_NAMES).toLowerCase();
  const domain = pick(config.emailDomains ?? DEFAULT_DOMAINS);
  const num = randInt(1, 99);
  return `${first}.${last}${num}@${domain}`;
}

function makePhone(): string {
  return `+1-555-${String(randInt(1000, 9999))}`;
}

function userIdentifier(
  channel: ChannelType,
  config: OrgVerticalConfig,
): string {
  if (VOICE_CHANNELS.has(channel)) return makePhone();
  return makeEmail(config);
}

// ============================================================================
// Tool-call helpers
// ============================================================================

function toolCallId(): string {
  return `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

interface ToolCallPair {
  assistant: {
    role: "assistant";
    content: null;
    toolCallId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  };
  tool: {
    role: "tool";
    content: null;
    toolCallId: string;
    toolName: string;
    toolOutput: Record<string, unknown>;
    toolStatus: "success" | "error";
  };
}

function makeToolCall(
  connectorSlug: string,
  toolSlug: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): ToolCallPair {
  const id = toolCallId();
  const name = `${connectorSlug}_${toolSlug}`;
  return {
    assistant: {
      role: "assistant",
      content: null,
      toolCallId: id,
      toolName: name,
      toolInput: input,
    },
    tool: {
      role: "tool",
      content: null,
      toolCallId: id,
      toolName: name,
      toolOutput: output,
      toolStatus: "success",
    },
  };
}

// ============================================================================
// Message type
// ============================================================================

type Message = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  toolStatus?: "success" | "error";
};

// ============================================================================
// Link type
// ============================================================================

interface LinkDef {
  url: string;
  title: string;
  connectorSlug?: string;
  resourceType?: string;
}

interface ScenarioResult {
  messages: Message[];
  links: LinkDef[];
}

// ============================================================================
// Medusa scenarios
// ============================================================================

function productInquiry(cfg: OrgVerticalConfig): ScenarioResult {
  const slug = cfg.ecommerce.connectorSlug;
  const p1 = pick(cfg.products);
  const others = cfg.products.filter((p) => p !== p1);
  const p2 = others.length > 0 ? pick(others) : p1;
  const msgs: Message[] = [];

  msgs.push({
    role: "user",
    content: pick([
      `What ${p1.category} do you have?`,
      `I'm looking for a good ${p1.category} product.`,
      `Can you tell me about the ${p1.name}?`,
      `Do you carry ${p1.category}?`,
    ]),
  });

  const tc1 = makeToolCall(
    slug,
    "list_products",
    { query: p1.category },
    {
      products: [
        { id: crypto.randomUUID(), name: p1.name, price: p1.price },
        { id: crypto.randomUUID(), name: p2.name, price: p2.price },
      ],
    },
  );
  msgs.push(tc1.assistant, tc1.tool);

  msgs.push({
    role: "assistant",
    content: `We have some great options! The **${p1.name}** is $${p1.price} and the **${p2.name}** is $${p2.price}. Would you like more details on either?`,
  });

  msgs.push({ role: "user", content: `Tell me more about the ${p1.name}` });

  const tc2 = makeToolCall(
    slug,
    "get_product",
    { productId: crypto.randomUUID() },
    {
      name: p1.name,
      price: p1.price,
      variants: p1.variants,
      description: `High-quality ${p1.category} product`,
    },
  );
  msgs.push(tc2.assistant, tc2.tool);

  msgs.push({
    role: "assistant",
    content: `The **${p1.name}** ($${p1.price}) is available in ${p1.variants.join(", ")}. It's one of our most popular items. Would you like to add it to your cart?`,
  });

  if (Math.random() > 0.5) {
    msgs.push({ role: "user", content: "I'll think about it, thanks!" });
    msgs.push({
      role: "assistant",
      content: "No problem! Feel free to reach out whenever you're ready.",
    });
  }

  const links: LinkDef[] = [p1, p2].map((p) => ({
    url: productUrl(cfg, p),
    title: p.name,
    connectorSlug: slug,
    resourceType: "product",
  }));

  return { messages: msgs, links };
}

function purchaseFlow(cfg: OrgVerticalConfig): ScenarioResult {
  const slug = cfg.ecommerce.connectorSlug;
  const product = pick(cfg.products);
  const variant = pick(product.variants);
  const msgs: Message[] = [];
  const cartId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  msgs.push({
    role: "user",
    content: pick([
      `I'd like to buy the ${product.name}`,
      `Can I order a ${product.name} in ${variant}?`,
      `I want to purchase the ${product.name}`,
    ]),
  });

  msgs.push({
    role: "assistant",
    content: `Great choice! Let me set up a cart for the ${product.name} (${variant}).`,
  });

  const tc1 = makeToolCall(slug, "create_cart", {}, { cartId });
  msgs.push(tc1.assistant, tc1.tool);

  const tc2 = makeToolCall(
    slug,
    "add_to_cart",
    { cartId, variantId, quantity: 1 },
    {
      cartId,
      items: [
        { name: product.name, variant, quantity: 1, price: product.price },
      ],
      total: product.price,
    },
  );
  msgs.push(tc2.assistant, tc2.tool);

  msgs.push({
    role: "assistant",
    content: `Added **${product.name}** (${variant}) to your cart. Total: $${product.price}. I'll need a delivery address to proceed.`,
  });

  const streetNum = randInt(100, 9999);
  const streets = ["Main St", "Oak Ave", "Elm Dr", "Park Blvd", "Cedar Ln"];
  const cities = ["Austin", "Portland", "Denver", "Seattle", "Chicago"];
  const states = ["TX", "OR", "CO", "WA", "IL"];
  const cityIdx = Math.floor(Math.random() * cities.length);

  msgs.push({
    role: "user",
    content: `${streetNum} ${pick(streets)}, ${cities[cityIdx]}, ${states[cityIdx]} ${randInt(10000, 99999)}`,
  });

  const tc3 = makeToolCall(
    slug,
    "set_delivery_address",
    { cartId, address: `${streetNum} ${pick(streets)}` },
    { success: true },
  );
  msgs.push(tc3.assistant, tc3.tool);

  msgs.push({
    role: "assistant",
    content: `Address saved! Order summary:\n- ${product.name} (${variant}): $${product.price}\n- Shipping: Free\n- **Total: $${product.price}**\n\nShall I complete your order?`,
  });

  msgs.push({ role: "user", content: "Yes, go ahead!" });

  const orderId = `${cfg.orderPrefix}${randInt(30000, 39999)}`;
  const tc4 = makeToolCall(
    slug,
    "complete_cart",
    { cartId },
    { orderId, status: "confirmed" },
  );
  msgs.push(tc4.assistant, tc4.tool);

  msgs.push({
    role: "assistant",
    content:
      "Your order is confirmed! You'll receive a confirmation email shortly. Is there anything else?",
  });

  msgs.push({
    role: "user",
    content: pick([
      "No, that's all!",
      "Nope, thanks!",
      "That's everything, thank you!",
    ]),
  });

  msgs.push({
    role: "assistant",
    content: "Thank you for your purchase! Have a great day!",
  });

  const links: LinkDef[] = [
    {
      url: productUrl(cfg, product),
      title: product.name,
      connectorSlug: slug,
      resourceType: "product",
    },
    {
      url: `${cfg.baseUrl}/orders/${orderId}`,
      title: `Order ${orderId}`,
      connectorSlug: slug,
      resourceType: "order",
    },
  ];

  return { messages: msgs, links };
}

function orderStatus(cfg: OrgVerticalConfig): ScenarioResult {
  const slug = cfg.ecommerce.connectorSlug;
  const orderId = `${cfg.orderPrefix}${randInt(20000, 29999)}`;
  const product = pick(cfg.products);
  const msgs: Message[] = [];

  msgs.push({
    role: "user",
    content: pick([
      `Where's my order ${orderId}?`,
      `Can you check order ${orderId} for me?`,
      `I'd like to check the status of order ${orderId}`,
      "What's the status of my order?",
    ]),
  });

  const statusOptions = ["shipped", "processing", "delivered", "in_transit"];
  const status = pick(statusOptions);

  if (Math.random() > 0.5) {
    const tc = makeToolCall(
      slug,
      "get_order",
      { orderId },
      {
        orderId,
        status,
        items: [{ name: product.name, quantity: 1, price: product.price }],
      },
    );
    msgs.push(tc.assistant, tc.tool);
  } else {
    const email = makeEmail(cfg);
    msgs.push({
      role: "assistant",
      content: "Sure! Can you provide the email used for the order?",
    });
    msgs.push({ role: "user", content: email });
    const tc = makeToolCall(
      slug,
      "look_up_order",
      { email, orderNumber: orderId },
      {
        orderId,
        status,
        items: [{ name: product.name, quantity: 1, price: product.price }],
      },
    );
    msgs.push(tc.assistant, tc.tool);
  }

  const statusText: Record<string, string> = {
    shipped: `Your order ${orderId} has shipped and is on its way! Expected delivery in 2-3 business days.`,
    processing: `Your order ${orderId} is being processed. It should ship within 24 hours.`,
    delivered: `Your order ${orderId} was delivered! If you haven't received it, please check with your building or neighbors.`,
    in_transit: `Your order ${orderId} is in transit — should arrive tomorrow.`,
  };

  msgs.push({ role: "assistant", content: statusText[status] });
  msgs.push({
    role: "user",
    content: pick([
      "Great, thanks!",
      "OK, thank you",
      "Got it, appreciate the help",
    ]),
  });
  msgs.push({
    role: "assistant",
    content: "You're welcome! Let me know if there's anything else.",
  });

  const links: LinkDef[] = [
    {
      url: `${cfg.baseUrl}/orders/${orderId}`,
      title: `Order ${orderId}`,
      connectorSlug: slug,
      resourceType: "order",
    },
  ];
  if (status === "shipped" || status === "in_transit") {
    links.push({
      url: `https://tracking.example.com/pkg/${crypto.randomUUID().slice(0, 12)}`,
      title: "Shipment Tracking",
      resourceType: "tracking",
    });
  }

  return { messages: msgs, links };
}

function returnExchange(cfg: OrgVerticalConfig): ScenarioResult {
  const product = pick(cfg.products);
  const orderId = `${cfg.orderPrefix}${randInt(20000, 29999)}`;
  const slug = cfg.ecommerce.connectorSlug;
  const msgs: Message[] = [];

  const reasons = [
    "it's not working properly",
    "I changed my mind",
    "I received the wrong item",
    "it arrived damaged",
    "the quality isn't what I expected",
  ];

  msgs.push({
    role: "user",
    content: pick([
      `I need to return my ${product.name} from order ${orderId}`,
      `I'd like to exchange my ${product.name}`,
      `How do I return order ${orderId}?`,
    ]),
  });

  msgs.push({
    role: "assistant",
    content: "I can help with that. May I ask the reason for the return?",
  });
  msgs.push({ role: "user", content: `Yeah, ${pick(reasons)}.` });

  msgs.push({
    role: "assistant",
    content: `I understand. I've initiated a return for your **${product.name}** (order ${orderId}). You'll receive a prepaid return label via email within the hour. Once we receive the item, your refund of $${product.price} will be processed in 3-5 business days.`,
  });

  msgs.push({
    role: "user",
    content: pick([
      "Sounds good, thank you",
      "OK thanks",
      "Perfect, I'll send it back today",
    ]),
  });
  msgs.push({
    role: "assistant",
    content:
      "You're welcome! If you have any other questions, don't hesitate to reach out.",
  });

  const retId = `RET-${randInt(1000, 9999)}`;
  const links: LinkDef[] = [
    {
      url: `${cfg.baseUrl}/orders/${orderId}`,
      title: `Order ${orderId}`,
      connectorSlug: slug,
      resourceType: "order",
    },
    {
      url: productUrl(cfg, product),
      title: product.name,
      connectorSlug: slug,
      resourceType: "product",
    },
    {
      url: `${cfg.baseUrl}/returns/${retId}`,
      title: `Return ${retId}`,
      connectorSlug: slug,
      resourceType: "return",
    },
  ];

  return { messages: msgs, links };
}

// ============================================================================
// Zendesk scenarios
// ============================================================================

function ticketLookup(cfg: OrgVerticalConfig): ScenarioResult {
  const slug = cfg.helpdesk.connectorSlug;
  const template = pick(cfg.ticketTemplates);
  const ticketId = randInt(cfg.ticketIdRange[0], cfg.ticketIdRange[1]);
  const msgs: Message[] = [];

  msgs.push({
    role: "user",
    content: pick([
      `Can you check on my ticket #${ticketId}?`,
      `What's the status of ticket ${ticketId}?`,
      `I submitted a request about "${template.subject}" — any update?`,
    ]),
  });

  const tc1 = makeToolCall(
    slug,
    "get_ticket",
    { ticketId },
    {
      id: ticketId,
      subject: template.subject,
      status: pick(["open", "pending", "solved"]),
      priority: template.priority,
      tags: template.tags,
      createdAt: new Date(Date.now() - randInt(1, 7) * 86400000).toISOString(),
    },
  );
  msgs.push(tc1.assistant, tc1.tool);

  const tc2 = makeToolCall(
    slug,
    "list_ticket_comments",
    { ticketId },
    {
      comments: [
        {
          id: randInt(1000, 9999),
          body: "We're looking into this and will update shortly.",
          public: true,
          createdAt: new Date(
            Date.now() - randInt(1, 3) * 86400000,
          ).toISOString(),
        },
      ],
    },
  );
  msgs.push(tc2.assistant, tc2.tool);

  msgs.push({
    role: "assistant",
    content: `I found your ticket #${ticketId} — "${template.subject}". It's currently being reviewed by our team. The last update says they're working on it and will follow up shortly. Would you like me to add a note to expedite it?`,
  });

  msgs.push({
    role: "user",
    content: pick([
      "Yes please, it's been a while",
      "No, that's fine. I'll wait.",
      "Just wanted to check, thanks",
    ]),
  });

  if (Math.random() > 0.5) {
    msgs.push({
      role: "assistant",
      content:
        "I've added a priority note to your ticket. You should hear back within 24 hours. Anything else?",
    });
  } else {
    msgs.push({
      role: "assistant",
      content:
        "No problem. You'll receive an email as soon as there's an update. Anything else I can help with?",
    });
  }

  msgs.push({ role: "user", content: "That's all, thanks." });

  const links: LinkDef[] = [
    {
      url: `${cfg.helpdeskBaseUrl}/tickets/${ticketId}`,
      title: `Ticket #${ticketId}`,
      connectorSlug: slug,
      resourceType: "ticket",
    },
  ];

  return { messages: msgs, links };
}

function ticketCreation(cfg: OrgVerticalConfig): ScenarioResult {
  const slug = cfg.helpdesk.connectorSlug;
  const template = pick(cfg.ticketTemplates);
  const ticketId = randInt(cfg.ticketIdRange[0], cfg.ticketIdRange[1]);
  const msgs: Message[] = [];

  msgs.push({
    role: "user",
    content: pick([
      `I have an issue — ${template.subject.toLowerCase()}.`,
      `I need help with something: ${template.subject.toLowerCase()}.`,
      `Can you create a support ticket? ${template.subject}`,
    ]),
  });

  msgs.push({
    role: "assistant",
    content:
      "I'm sorry to hear that. Let me create a support ticket so our team can look into this right away. Can you provide any additional details?",
  });

  msgs.push({
    role: "user",
    content: pick([
      "This has been going on for a few days now.",
      "It happened earlier today and I need it resolved quickly.",
      "I've already tried the usual steps but nothing worked.",
    ]),
  });

  const tc = makeToolCall(
    slug,
    "create_ticket",
    {
      subject: template.subject,
      body: `Customer reported: ${template.subject.toLowerCase()}. Additional context provided during conversation.`,
      priority: template.priority,
      type: template.type,
      tags: template.tags,
    },
    {
      id: ticketId,
      status: "new",
      subject: template.subject,
    },
  );
  msgs.push(tc.assistant, tc.tool);

  msgs.push({
    role: "assistant",
    content: `I've created ticket #${ticketId} for you — "${template.subject}". Our team will review it and you'll receive updates via email. Is there anything else?`,
  });

  msgs.push({
    role: "user",
    content: pick([
      "No, that's all. Thank you.",
      "That's it for now.",
      "Thanks for the help.",
    ]),
  });

  const links: LinkDef[] = [
    {
      url: `${cfg.helpdeskBaseUrl}/tickets/${ticketId}`,
      title: `Ticket #${ticketId}`,
      connectorSlug: slug,
      resourceType: "ticket",
    },
  ];

  return { messages: msgs, links };
}

function ticketEscalation(cfg: OrgVerticalConfig): ScenarioResult {
  const slug = cfg.helpdesk.connectorSlug;
  const template = pick(cfg.ticketTemplates);
  const ticketId = randInt(cfg.ticketIdRange[0], cfg.ticketIdRange[1]);
  const msgs: Message[] = [];

  msgs.push({
    role: "user",
    content: pick([
      `Ticket #${ticketId} has been open for too long. Can you escalate it?`,
      `I need ticket ${ticketId} prioritized — this is urgent now.`,
      `No one has responded to my ticket #${ticketId}. I need this resolved today.`,
    ]),
  });

  const tc1 = makeToolCall(
    slug,
    "get_ticket",
    { ticketId },
    {
      id: ticketId,
      subject: template.subject,
      status: "pending",
      priority: template.priority,
      tags: template.tags,
      createdAt: new Date(Date.now() - randInt(3, 10) * 86400000).toISOString(),
    },
  );
  msgs.push(tc1.assistant, tc1.tool);

  msgs.push({
    role: "assistant",
    content: `I can see ticket #${ticketId} — "${template.subject}". I understand your frustration. Let me escalate this to high priority right away.`,
  });

  const tc2 = makeToolCall(
    slug,
    "update_ticket",
    {
      ticketId,
      priority: "urgent",
      status: "open",
      tags: [...template.tags, "escalated"],
    },
    {
      id: ticketId,
      status: "open",
      priority: "urgent",
    },
  );
  msgs.push(tc2.assistant, tc2.tool);

  msgs.push({
    role: "assistant",
    content: `Done — ticket #${ticketId} has been escalated to urgent priority and reassigned to our senior team. You should receive a response within 4 hours. I apologize for the delay.`,
  });

  msgs.push({
    role: "user",
    content: pick([
      "Thank you, I appreciate that.",
      "OK, please make sure someone follows up.",
      "Thanks for escalating.",
    ]),
  });

  const links: LinkDef[] = [
    {
      url: `${cfg.helpdeskBaseUrl}/tickets/${ticketId}`,
      title: `Ticket #${ticketId} (Escalated)`,
      connectorSlug: slug,
      resourceType: "ticket",
    },
  ];

  return { messages: msgs, links };
}

// ============================================================================
// General question scenario
// ============================================================================

function generalQuestion(cfg: OrgVerticalConfig): ScenarioResult {
  const qa = pick(cfg.generalQA);
  const msgs: Message[] = [
    { role: "user", content: qa.q },
    { role: "assistant", content: qa.a },
    {
      role: "user",
      content: pick([
        "Thanks!",
        "Great, thanks for the info!",
        "Got it, appreciate it",
      ]),
    },
    {
      role: "assistant",
      content: pick([
        "Anytime! Have a great day!",
        "Happy to help! Anything else?",
        "You're welcome!",
      ]),
    },
  ];
  return { messages: msgs, links: [] };
}

// ============================================================================
// URL helpers
// ============================================================================

function productUrl(cfg: OrgVerticalConfig, product: Product): string {
  return `${cfg.baseUrl}/products/${product.name
    .toLowerCase()
    .replace(/["\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")}`;
}

// ============================================================================
// Scenario dispatch
// ============================================================================

function generateScenario(
  scenario: Scenario,
  cfg: OrgVerticalConfig,
): ScenarioResult {
  switch (scenario) {
    case "product_inquiry":
      return productInquiry(cfg);
    case "purchase_flow":
      return purchaseFlow(cfg);
    case "order_status":
      return orderStatus(cfg);
    case "return_exchange":
      return returnExchange(cfg);
    case "ticket_lookup":
      return ticketLookup(cfg);
    case "ticket_creation":
      return ticketCreation(cfg);
    case "ticket_escalation":
      return ticketEscalation(cfg);
    case "general_question":
      return generalQuestion(cfg);
  }
}

// ============================================================================
// Date distribution
// ============================================================================

function pickHour(): number {
  return weightedPick(HOUR_WEIGHTS.map((w, i) => ({ value: i, weight: w })));
}

function distributeSessions(): Date[] {
  const now = new Date();
  const dates: Date[] = [];

  for (let day = DAYS_BACK; day >= 0; day--) {
    const d = new Date(now);
    d.setDate(d.getDate() - day);
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const baseCount = Math.round(SESSION_COUNT / DAYS_BACK);
    const count = isWeekend
      ? Math.round(baseCount * 0.6)
      : Math.round(baseCount * (0.9 + Math.random() * 0.4));

    for (let i = 0; i < count && dates.length < SESSION_COUNT; i++) {
      const hour = pickHour();
      const minute = randInt(0, 59);
      const ts = new Date(d);
      ts.setHours(hour, minute, randInt(0, 59), 0);
      dates.push(ts);
    }
  }

  while (dates.length < SESSION_COUNT) {
    const day = randInt(1, DAYS_BACK);
    const d = new Date(now);
    d.setDate(d.getDate() - day);
    d.setHours(pickHour(), randInt(0, 59), randInt(0, 59), 0);
    dates.push(d);
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

// ============================================================================
// Main generator
// ============================================================================

export async function generateSessions(
  db: SeedDb,
  orgId: string,
  agents: { id: string; name: string }[],
  config: OrgVerticalConfig,
): Promise<void> {
  const voiceAgent = agents[0];
  const chatAgent = agents[1] ?? agents[0];
  if (!voiceAgent) {
    console.warn("  Skipping generated sessions: no agents");
    return;
  }

  const dates = distributeSessions();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Build all session values
  const sessionValues: {
    id: string;
    organizationId: string;
    agentId: string;
    channelType: ChannelType;
    status: "active" | "completed" | "abandoned";
    userIdentifier: string;
    startedAt: Date;
    endedAt: Date | null;
  }[] = [];

  const sessionScenarios: { scenario: Scenario; startedAt: Date }[] = [];

  for (const startedAt of dates) {
    const channel = weightedPick(config.channelWeights);
    const agentId = VOICE_CHANNELS.has(channel) ? voiceAgent.id : chatAgent.id;
    const isToday = startedAt >= todayStart;

    let status: "active" | "completed" | "abandoned";
    if (isToday && Math.random() < 0.15) {
      status = "active";
    } else if (Math.random() < 0.75) {
      status = "completed";
    } else {
      status = "abandoned";
    }

    const durationMinutes = randInt(3, 20);
    const endedAt =
      status === "active"
        ? null
        : new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

    const scenario = weightedPick(config.scenarioWeights);

    sessionValues.push({
      id: crypto.randomUUID(),
      organizationId: orgId,
      agentId,
      channelType: channel,
      status,
      userIdentifier: userIdentifier(channel, config),
      startedAt,
      endedAt,
    });

    sessionScenarios.push({ scenario, startedAt });
  }

  // Batch insert sessions
  await db.insert(sessions).values(sessionValues).onConflictDoNothing();

  // Generate messages and links
  const allMessages: {
    id: string;
    sessionId: string;
    role: "user" | "assistant" | "tool";
    content: string | null;
    toolCallId: string | undefined;
    toolName: string | undefined;
    toolInput: Record<string, unknown> | undefined;
    toolOutput: Record<string, unknown> | undefined;
    toolStatus: string | undefined;
    createdAt: Date;
    occurredAt: Date;
  }[] = [];

  const allLinks: {
    id: string;
    sessionId: string;
    url: string;
    title: string;
    connectorSlug: string | undefined;
    resourceType: string | undefined;
  }[] = [];

  for (let i = 0; i < sessionValues.length; i++) {
    const session = sessionValues[i];
    const { scenario, startedAt } = sessionScenarios[i];
    const result = generateScenario(scenario, config);
    let msgs = result.messages;

    // Abandoned sessions: user dropped off early
    if (session.status === "abandoned") {
      const cutoff = Math.min(msgs.length, randInt(2, 3));
      msgs = msgs.slice(0, cutoff);
    }

    let elapsed = 0;
    for (const msg of msgs) {
      elapsed += randInt(3000, 15000);
      const ts = new Date(startedAt.getTime() + elapsed);
      allMessages.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolName: msg.toolName,
        toolInput: msg.toolInput,
        toolOutput: msg.toolOutput,
        toolStatus: msg.toolStatus,
        createdAt: ts,
        occurredAt: ts,
      });
    }

    for (const link of result.links) {
      allLinks.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        url: link.url,
        title: link.title,
        connectorSlug: link.connectorSlug,
        resourceType: link.resourceType,
      });
    }
  }

  // Insert messages in chunks
  const MSG_CHUNK = 500;
  for (let i = 0; i < allMessages.length; i += MSG_CHUNK) {
    await db
      .insert(sessionMessages)
      .values(allMessages.slice(i, i + MSG_CHUNK))
      .onConflictDoNothing();
  }

  // Generate feedback
  const feedbackValues: {
    id: string;
    sessionId: string;
    rating: number;
    comment: string;
    feedbackSource: "customer" | "support";
  }[] = [];

  for (const session of sessionValues) {
    if (session.status !== "completed") continue;

    // ~55% customer feedback
    if (Math.random() < 0.55) {
      const positive = Math.random() < 0.8;
      feedbackValues.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        rating: positive ? 2 : 1,
        comment: positive
          ? pick(config.feedback.positiveCustomer)
          : pick(config.feedback.negativeCustomer),
        feedbackSource: "customer",
      });
    }

    // ~25% support feedback
    if (Math.random() < 0.25) {
      const positive = Math.random() < 0.7;
      feedbackValues.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        rating: positive ? 2 : 1,
        comment: positive
          ? pick(config.feedback.positiveSupport)
          : pick(config.feedback.negativeSupport),
        feedbackSource: "support",
      });
    }
  }

  if (feedbackValues.length > 0) {
    for (let i = 0; i < feedbackValues.length; i += MSG_CHUNK) {
      await db
        .insert(sessionFeedback)
        .values(feedbackValues.slice(i, i + MSG_CHUNK))
        .onConflictDoNothing();
    }
  }

  // Insert links in chunks
  if (allLinks.length > 0) {
    for (let i = 0; i < allLinks.length; i += MSG_CHUNK) {
      await db
        .insert(sessionLinks)
        .values(allLinks.slice(i, i + MSG_CHUNK))
        .onConflictDoNothing();
    }
  }

  console.log(
    `  Generated ${sessionValues.length} sessions, ${allMessages.length} messages, ${feedbackValues.length} feedback, ${allLinks.length} links`,
  );
}
