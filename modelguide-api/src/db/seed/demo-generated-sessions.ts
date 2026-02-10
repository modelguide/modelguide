/**
 * Demo session generator.
 * Produces ~300 sessions over 45 days with realistic conversations,
 * tool calls, and feedback to make the dashboard feel alive.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";
import { sessionFeedback, sessionMessages, sessions } from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

// ============================================================================
// Random helpers
// ============================================================================

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick<T>(items: readonly { value: T; weight: number }[]): T {
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

type ChannelType =
  | "web"
  | "voice"
  | "widget"
  | "whatsapp"
  | "email"
  | "sms"
  | "slack"
  | "api";

const CHANNELS: { value: ChannelType; weight: number }[] = [
  { value: "web", weight: 40 },
  { value: "voice", weight: 20 },
  { value: "widget", weight: 15 },
  { value: "whatsapp", weight: 10 },
  { value: "email", weight: 8 },
  { value: "sms", weight: 4 },
  { value: "slack", weight: 2 },
  { value: "api", weight: 1 },
];

/** Channels that map to the Voice Assistant agent */
const VOICE_CHANNELS = new Set<ChannelType>(["voice", "sms", "whatsapp"]);

/** Hourly weights — peak 10–18 */
const HOUR_WEIGHTS = [
  1, 1, 1, 1, 1, 2, 3, 5, 7, 9, 10, 10, 9, 10, 10, 9, 8, 7, 5, 4, 3, 2, 1, 1,
];

// ============================================================================
// Product catalog
// ============================================================================

interface Product {
  name: string;
  price: number;
  variants: string[];
  category: string;
}

const PRODUCTS: Product[] = [
  {
    name: "ProBook 15",
    price: 1299,
    variants: ["Silver", "Space Gray"],
    category: "laptops",
  },
  {
    name: "SoundMax Pro",
    price: 179,
    variants: ["Black", "Silver", "Midnight Blue"],
    category: "audio",
  },
  {
    name: 'UltraView 27"',
    price: 449,
    variants: ["Silver", "Black"],
    category: "monitors",
  },
  {
    name: "AudioElite Wireless",
    price: 149,
    variants: ["White", "Black"],
    category: "audio",
  },
  {
    name: "ClearTone ANC",
    price: 129,
    variants: ["White", "Gray", "Rose"],
    category: "audio",
  },
  {
    name: "ProBook 13",
    price: 999,
    variants: ["Silver", "Graphite"],
    category: "laptops",
  },
  {
    name: "USB-C Hub Pro",
    price: 69,
    variants: ["Silver"],
    category: "accessories",
  },
  {
    name: "SmartCharge 65W",
    price: 49,
    variants: ["White", "Black"],
    category: "accessories",
  },
];

// ============================================================================
// Name & domain pools for user identifiers
// ============================================================================

const FIRST_NAMES = [
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

const LAST_NAMES = [
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

const DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "company.co",
  "work.io",
];

function makeEmail(): string {
  const first = pick(FIRST_NAMES).toLowerCase();
  const last = pick(LAST_NAMES).toLowerCase();
  const domain = pick(DOMAINS);
  const num = randInt(1, 99);
  return `${first}.${last}${num}@${domain}`;
}

function makePhone(): string {
  return `+1-555-${String(randInt(1000, 9999))}`;
}

function userIdentifier(channel: ChannelType): string {
  if (VOICE_CHANNELS.has(channel)) return makePhone();
  return makeEmail();
}

// ============================================================================
// Feedback comment pools
// ============================================================================

const POSITIVE_CUSTOMER_COMMENTS = [
  "Very helpful, thanks!",
  "Quick and easy",
  "Great service",
  "Exactly what I needed",
  "Super fast response",
  "Really impressed with the help",
  "Smooth experience",
  "Couldn't be happier",
  "The agent was very knowledgeable",
  "Wonderful support",
];

const NEGATIVE_CUSTOMER_COMMENTS = [
  "Could have been faster",
  "Didn't fully resolve my issue",
  "Had to repeat myself",
  "Expected more detail",
  "Confusing at first",
  "Took too long",
];

const POSITIVE_SUPPORT_COMMENTS = [
  "Agent followed protocol correctly",
  "Clean conversation flow",
  "Efficient resolution",
  "Handled edge case well",
  "Good tone throughout",
];

const NEGATIVE_SUPPORT_COMMENTS = [
  "Missed upsell opportunity",
  "Slightly off-script",
  "Could be more concise",
  "Should have confirmed before proceeding",
];

// ============================================================================
// Tool-call helpers
// ============================================================================

const CONNECTOR_SLUG = "techstore";

function toolName(slug: string): string {
  return `${CONNECTOR_SLUG}_${slug}`;
}

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
  };
}

function makeToolCall(
  name: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): ToolCallPair {
  const id = toolCallId();
  return {
    assistant: {
      role: "assistant",
      content: null,
      toolCallId: id,
      toolName: toolName(name),
      toolInput: input,
    },
    tool: {
      role: "tool",
      content: null,
      toolCallId: id,
      toolName: toolName(name),
      toolOutput: output,
    },
  };
}

// ============================================================================
// Scenario generators
// ============================================================================

type Message = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
};

function productInquiry(): Message[] {
  const p1 = pick(PRODUCTS);
  const p2 = pick(PRODUCTS.filter((p) => p !== p1));
  const msgs: Message[] = [];

  msgs.push({
    role: "user",
    content: pick([
      `What ${p1.category} do you have?`,
      `I'm looking for a good ${p1.category === "audio" ? "pair of headphones" : p1.category === "laptops" ? "laptop" : p1.category === "monitors" ? "monitor" : "accessory"}.`,
      `Can you tell me about the ${p1.name}?`,
      `Do you carry ${p1.category}?`,
    ]),
  });

  const tc1 = makeToolCall(
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

  msgs.push({
    role: "user",
    content: `Tell me more about the ${p1.name}`,
  });

  const tc2 = makeToolCall(
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
    msgs.push({
      role: "user",
      content: "I'll think about it, thanks!",
    });
    msgs.push({
      role: "assistant",
      content:
        "No problem! Feel free to reach out whenever you're ready. Have a great day!",
    });
  }

  return msgs;
}

function purchaseFlow(): Message[] {
  const product = pick(PRODUCTS);
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
    content: `Great choice! Let me set up a cart for the ${product.name} (${variant}). One moment...`,
  });

  const tc1 = makeToolCall("create_cart", {}, { cartId });
  msgs.push(tc1.assistant, tc1.tool);

  const tc2 = makeToolCall(
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
    "set_delivery_address",
    { cartId, address: `${streetNum} ${pick(streets)}` },
    { success: true },
  );
  msgs.push(tc3.assistant, tc3.tool);

  msgs.push({
    role: "assistant",
    content: `Address saved! Here's your order summary:\n- ${product.name} (${variant}): $${product.price}\n- Shipping: Free\n- **Total: $${product.price}**\n\nShall I complete your order?`,
  });

  msgs.push({ role: "user", content: "Yes, go ahead!" });

  const tc4 = makeToolCall(
    "complete_cart",
    { cartId },
    { orderId: `TK-${randInt(30000, 39999)}`, status: "confirmed" },
  );
  msgs.push(tc4.assistant, tc4.tool);

  msgs.push({
    role: "assistant",
    content: `Your order is confirmed! You'll receive a confirmation email shortly. Is there anything else I can help with?`,
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

  return msgs;
}

function orderStatus(): Message[] {
  const orderId = `TK-${randInt(20000, 29999)}`;
  const msgs: Message[] = [];
  const product = pick(PRODUCTS);

  msgs.push({
    role: "user",
    content: pick([
      `Where's my order ${orderId}?`,
      `Can you check order ${orderId} for me?`,
      `I'd like to check the status of order ${orderId}`,
      `What's the status of my order?`,
    ]),
  });

  const useGetOrder = Math.random() > 0.5;
  const statusOptions = ["shipped", "processing", "delivered", "in_transit"];
  const orderStatus = pick(statusOptions);

  if (useGetOrder) {
    const tc = makeToolCall(
      "get_order",
      { orderId },
      {
        orderId,
        status: orderStatus,
        items: [{ name: product.name, quantity: 1, price: product.price }],
      },
    );
    msgs.push(tc.assistant, tc.tool);
  } else {
    const email = makeEmail();
    msgs.push({
      role: "assistant",
      content: "Sure! Can you provide the email address used for the order?",
    });
    msgs.push({ role: "user", content: email });
    const tc = makeToolCall(
      "look_up_order",
      { email, orderNumber: orderId },
      {
        orderId,
        status: orderStatus,
        items: [{ name: product.name, quantity: 1, price: product.price }],
      },
    );
    msgs.push(tc.assistant, tc.tool);
  }

  const statusText: Record<string, string> = {
    shipped: `Your order ${orderId} has shipped and is on its way! Expected delivery in 2-3 business days.`,
    processing: `Your order ${orderId} is being processed. It should ship within 24 hours.`,
    delivered: `Your order ${orderId} was delivered! If you haven't received it, please check with your building or neighbors.`,
    in_transit: `Your order ${orderId} is in transit. The tracking shows it's at the local distribution center — should arrive tomorrow.`,
  };

  msgs.push({
    role: "assistant",
    content: statusText[orderStatus],
  });

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

  return msgs;
}

function returnExchange(): Message[] {
  const product = pick(PRODUCTS);
  const orderId = `TK-${randInt(20000, 29999)}`;
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

  msgs.push({
    role: "user",
    content: `Yeah, ${pick(reasons)}.`,
  });

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

  return msgs;
}

function generalQuestion(): Message[] {
  const msgs: Message[] = [];

  const qa = pick([
    {
      q: "Do you offer free shipping?",
      a: "Yes! We offer free standard shipping on all orders over $50. Express shipping is available for $9.99.",
    },
    {
      q: "What's your return policy?",
      a: "We have a 30-day return policy for all items in original condition. Returns are free — we'll send you a prepaid label.",
    },
    {
      q: "Do you have any current promotions?",
      a: "We're currently running a 15% off sale on all audio products! Use code AUDIO15 at checkout.",
    },
    {
      q: "What payment methods do you accept?",
      a: "We accept all major credit cards (Visa, Mastercard, Amex), PayPal, Apple Pay, and Google Pay.",
    },
    {
      q: "How long does delivery take?",
      a: "Standard shipping takes 3-5 business days. Express shipping (1-2 days) is available at checkout.",
    },
    {
      q: "Do you ship internationally?",
      a: "Yes! We ship to over 40 countries. International shipping rates vary by destination — you can check at checkout.",
    },
    {
      q: "Is the warranty transferable?",
      a: "Our standard warranty is tied to the original purchase, but extended warranty plans are transferable. Just contact us with the new owner's details.",
    },
    {
      q: "Can I change my delivery address after ordering?",
      a: "If your order hasn't shipped yet, absolutely! Just let me know the new address and I'll update it for you.",
    },
  ]);

  msgs.push({ role: "user", content: qa.q });
  msgs.push({ role: "assistant", content: qa.a });

  msgs.push({
    role: "user",
    content: pick([
      "Thanks!",
      "Great, thanks for the info!",
      "Got it, appreciate it",
    ]),
  });
  msgs.push({
    role: "assistant",
    content: pick([
      "Anytime! Have a great day!",
      "Happy to help! Anything else?",
      "You're welcome!",
    ]),
  });

  return msgs;
}

// ============================================================================
// Scenario dispatch
// ============================================================================

type Scenario = "inquiry" | "purchase" | "order_status" | "return" | "general";

const SCENARIOS: { value: Scenario; weight: number }[] = [
  { value: "inquiry", weight: 30 },
  { value: "purchase", weight: 20 },
  { value: "order_status", weight: 20 },
  { value: "return", weight: 15 },
  { value: "general", weight: 15 },
];

function generateMessages(scenario: Scenario): Message[] {
  switch (scenario) {
    case "inquiry":
      return productInquiry();
    case "purchase":
      return purchaseFlow();
    case "order_status":
      return orderStatus();
    case "return":
      return returnExchange();
    case "general":
      return generalQuestion();
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

  // Fill remaining if needed
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

export async function generateDemoSessions(
  db: SeedDb,
  orgId: string,
  agents: { id: string; name: string }[],
): Promise<void> {
  const voiceAgent = agents.find((a) => a.name.includes("Voice"));
  const chatAgent = agents.find((a) => a.name.includes("Chat"));
  if (!voiceAgent || !chatAgent) {
    console.warn("  Skipping generated sessions: agents not found");
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

  // Track scenario per session for message generation
  const sessionScenarios: { scenario: Scenario; startedAt: Date }[] = [];

  for (const startedAt of dates) {
    const channel = weightedPick(CHANNELS);
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

    const scenario = weightedPick(SCENARIOS);

    sessionValues.push({
      id: crypto.randomUUID(),
      organizationId: orgId,
      agentId,
      channelType: channel,
      status,
      userIdentifier: userIdentifier(channel),
      startedAt,
      endedAt,
    });

    sessionScenarios.push({ scenario, startedAt });
  }

  // Batch insert sessions
  await db.insert(sessions).values(sessionValues).onConflictDoNothing();

  // Generate and batch insert messages
  const allMessages: {
    id: string;
    sessionId: string;
    role: "user" | "assistant" | "tool";
    content: string | null;
    toolCallId: string | undefined;
    toolName: string | undefined;
    toolInput: Record<string, unknown> | undefined;
    toolOutput: Record<string, unknown> | undefined;
    createdAt: Date;
    occurredAt: Date;
  }[] = [];

  for (let i = 0; i < sessionValues.length; i++) {
    const session = sessionValues[i];
    const { scenario, startedAt } = sessionScenarios[i];
    let msgs = generateMessages(scenario);

    // Abandoned sessions: user dropped off mid-conversation
    if (session.status === "abandoned") {
      // Keep first 2-3 messages (opening exchange, maybe one more user msg)
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
        createdAt: ts,
        occurredAt: ts,
      });
    }
  }

  // Insert messages in chunks of 500 to avoid parameter limits
  const MSG_CHUNK = 500;
  for (let i = 0; i < allMessages.length; i += MSG_CHUNK) {
    await db
      .insert(sessionMessages)
      .values(allMessages.slice(i, i + MSG_CHUNK))
      .onConflictDoNothing();
  }

  // Generate and batch insert feedback
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
          ? pick(POSITIVE_CUSTOMER_COMMENTS)
          : pick(NEGATIVE_CUSTOMER_COMMENTS),
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
          ? pick(POSITIVE_SUPPORT_COMMENTS)
          : pick(NEGATIVE_SUPPORT_COMMENTS),
        feedbackSource: "support",
      });
    }
  }

  if (feedbackValues.length > 0) {
    await db
      .insert(sessionFeedback)
      .values(feedbackValues)
      .onConflictDoNothing();
  }

  console.log(
    `  Generated ${sessionValues.length} sessions, ${allMessages.length} messages, ${feedbackValues.length} feedback records`,
  );
}
