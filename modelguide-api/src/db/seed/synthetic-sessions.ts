/**
 * Synthetic session data seed script
 *
 * Generates ~100k realistic e-commerce sessions for a fashion store
 * modeled after a generic fashion store. Data spans ~10 months back at ~10k sessions/month.
 * Each session includes full conversation transcripts with messages, tool calls,
 * and feedback.
 *
 * Usage: bun run src/db/seed/synthetic-sessions.ts
 * Prerequisite: run `make db-seed` first (creates catalog, base orgs, etc.)
 */

import { generateApiKey } from "@lib/crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import {
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  sessionFeedback,
  sessionMessages,
  sessions,
  users,
} from "../schema";

type SeedDb = PostgresJsDatabase<typeof schema>;

// ============================================================================
// PRNG — Deterministic seeded random for reproducible data
// ============================================================================

/** Simple mulberry32 PRNG seeded once for reproducible runs */
function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = createRng(20250209);

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function weightedPick<T>(items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function uuid(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += "-";
    } else if (i === 14) {
      s += "4";
    } else if (i === 19) {
      s += hex[(randInt(0, 15) & 0x3) | 0x8];
    } else {
      s += hex[randInt(0, 15)];
    }
  }
  return s;
}

// ============================================================================
// Constants & product catalog
// ============================================================================

const TOTAL_SESSIONS = 100_000;
const MONTHS_BACK = 10;

const CHANNEL_WEIGHTS = [
  { value: "web" as const, weight: 55 },
  { value: "widget" as const, weight: 20 },
  { value: "whatsapp" as const, weight: 10 },
  { value: "voice" as const, weight: 8 },
  { value: "email" as const, weight: 5 },
  { value: "sms" as const, weight: 2 },
];

const STATUS_WEIGHTS = [
  { value: "completed" as const, weight: 65 },
  { value: "escalated" as const, weight: 15 },
  { value: "abandoned" as const, weight: 15 },
  { value: "active" as const, weight: 5 },
];

const STATUS_WEIGHTS_PAST = [
  { value: "completed" as const, weight: 68 },
  { value: "escalated" as const, weight: 16 },
  { value: "abandoned" as const, weight: 16 },
];

const FIRST_NAMES = [
  "Emma",
  "Olivia",
  "Sophia",
  "Isabella",
  "Charlotte",
  "Amelia",
  "Mia",
  "Harper",
  "Evelyn",
  "Abigail",
  "Sarah",
  "Jessica",
  "Rachel",
  "Laura",
  "Emily",
  "James",
  "William",
  "Benjamin",
  "Lucas",
  "Henry",
  "Alexander",
  "Daniel",
  "Matthew",
  "David",
  "Michael",
  "Ryan",
  "Nathan",
  "Thomas",
  "Robert",
  "Andrew",
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
  "Rodriguez",
  "Martinez",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Thompson",
  "White",
  "Clark",
];

const CITIES = [
  "New York",
  "Los Angeles",
  "Chicago",
  "Houston",
  "Phoenix",
  "Philadelphia",
  "San Antonio",
  "San Diego",
  "Dallas",
  "Austin",
  "Denver",
  "Seattle",
  "Portland",
  "Miami",
  "Boston",
];

const ZIP_CODES = [
  "10001",
  "90001",
  "60601",
  "77001",
  "85001",
  "19101",
  "78201",
  "92101",
  "75201",
  "73301",
  "80201",
  "98101",
  "97201",
  "33101",
  "02101",
];

const STREETS = [
  "Main St",
  "Broadway",
  "Oak Ave",
  "Elm St",
  "Park Ave",
  "Maple Dr",
  "Cedar Ln",
  "Pine St",
  "Washington Blvd",
  "Lake Shore Dr",
  "Market St",
  "Highland Ave",
];

interface Product {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  sizes: string[];
  colors: string[];
}

const PRODUCTS: Product[] = [
  {
    id: "prod_dress_01",
    name: "Midi Ruffle Dress",
    category: "dresses",
    brand: "Reserved",
    price: 49,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["black", "red", "navy"],
  },
  {
    id: "prod_dress_02",
    name: "Satin Cocktail Dress",
    category: "dresses",
    brand: "Mohito",
    price: 65,
    sizes: ["XS", "S", "M", "L"],
    colors: ["emerald", "burgundy", "black"],
  },
  {
    id: "prod_dress_03",
    name: "Floral Maxi Dress",
    category: "dresses",
    brand: "Sinsay",
    price: 35,
    sizes: ["S", "M", "L", "XL"],
    colors: ["multicolor", "white"],
  },
  {
    id: "prod_shoe_01",
    name: "Patent Leather Heels",
    category: "shoes",
    brand: "CCC",
    price: 45,
    sizes: ["6", "7", "8", "9", "10"],
    colors: ["black", "nude", "red"],
  },
  {
    id: "prod_shoe_02",
    name: "Platform Sneakers",
    category: "shoes",
    brand: "Nike",
    price: 119,
    sizes: ["6", "7", "8", "9", "10", "11", "12"],
    colors: ["white", "black", "pink"],
  },
  {
    id: "prod_shoe_03",
    name: "Heeled Ankle Boots",
    category: "shoes",
    brand: "Steve Madden",
    price: 99,
    sizes: ["6", "7", "8", "9", "10"],
    colors: ["black", "brown", "beige"],
  },
  {
    id: "prod_bag_01",
    name: "Leather Tote Bag",
    category: "bags",
    brand: "Coach",
    price: 89,
    sizes: ["one size"],
    colors: ["black", "brown", "camel"],
  },
  {
    id: "prod_bag_02",
    name: "Quilted Crossbody Bag",
    category: "bags",
    brand: "Guess",
    price: 139,
    sizes: ["one size"],
    colors: ["black", "white", "pink"],
  },
  {
    id: "prod_jacket_01",
    name: "Leather Biker Jacket",
    category: "jackets",
    brand: "Zara",
    price: 89,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["black"],
  },
  {
    id: "prod_jacket_02",
    name: "Oversized Wool Coat",
    category: "jackets",
    brand: "H&M",
    price: 129,
    sizes: ["S", "M", "L", "XL"],
    colors: ["beige", "grey", "black"],
  },
  {
    id: "prod_sweater_01",
    name: "Oversized Wool Sweater",
    category: "sweaters",
    brand: "Reserved",
    price: 42,
    sizes: ["S/M", "L/XL"],
    colors: ["ecru", "grey", "apricot"],
  },
  {
    id: "prod_sweater_02",
    name: "Cashmere Turtleneck",
    category: "sweaters",
    brand: "Massimo Dutti",
    price: 155,
    sizes: ["XS", "S", "M", "L"],
    colors: ["black", "camel", "navy"],
  },
  {
    id: "prod_jeans_01",
    name: "Mom Fit High Waist Jeans",
    category: "jeans",
    brand: "Levi's",
    price: 99,
    sizes: ["24", "25", "26", "27", "28", "29", "30", "31"],
    colors: ["light blue", "dark blue"],
  },
  {
    id: "prod_jeans_02",
    name: "Wide Leg Jeans",
    category: "jeans",
    brand: "Pull & Bear",
    price: 39,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["blue", "black"],
  },
  {
    id: "prod_acc_01",
    name: "Cashmere Scarf",
    category: "accessories",
    brand: "Weekend Max Mara",
    price: 179,
    sizes: ["one size"],
    colors: ["beige", "grey", "black"],
  },
  {
    id: "prod_acc_02",
    name: "Leather Belt with Buckle",
    category: "accessories",
    brand: "Tommy Hilfiger",
    price: 65,
    sizes: ["S", "M", "L"],
    colors: ["black", "brown"],
  },
  {
    id: "prod_sneaker_01",
    name: "Running Shoes",
    category: "sneakers",
    brand: "adidas",
    price: 129,
    sizes: ["8", "9", "10", "11", "12", "13"],
    colors: ["black/white", "grey/blue"],
  },
  {
    id: "prod_sneaker_02",
    name: "Retro '90s Sneakers",
    category: "sneakers",
    brand: "New Balance",
    price: 142,
    sizes: ["6", "7", "8", "9", "10", "11", "12"],
    colors: ["grey", "navy", "green"],
  },
];

const MODELS = ["claude-3.5-sonnet", "claude-3-haiku", "gpt-4o-mini"];

const POSITIVE_FEEDBACK_TAGS = [
  "good_resolution",
  "efficient",
  "correct_tool_usage",
];
const NEGATIVE_FEEDBACK_TAGS = [
  "wrong_tool",
  "poor_tone",
  "missed_intent",
  "hallucination",
];

const POSITIVE_COMMENTS = [
  "Fast and helpful service!",
  "Great help choosing the right size",
  "Agent gave excellent advice",
  "Shopping went smoothly, highly recommend",
  "Very pleasant conversation, thank you",
  "Great help with my order",
  "Quick and efficient service",
  "Resolved my issue perfectly",
];

const NEGATIVE_COMMENTS = [
  "Didn't understand my question",
  "Waited too long for a response",
  "Gave wrong size information",
  "Couldn't help with my return",
  "Agent seemed confused about products",
  "Didn't understand my return request",
];

// ============================================================================
// Scenario definitions
// ============================================================================

type ScenarioId =
  | "product_inquiry"
  | "browse_and_purchase"
  | "order_status"
  | "size_guide"
  | "return_exchange"
  | "delivery_inquiry"
  | "cart_abandonment"
  | "complaint"
  | "multi_item_purchase";

interface ScenarioConfig {
  weight: number;
  messageRange: [number, number];
  preferredStatus?: "escalated" | "abandoned";
}

const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  product_inquiry: { weight: 20, messageRange: [3, 4] },
  browse_and_purchase: { weight: 15, messageRange: [6, 8] },
  order_status: { weight: 15, messageRange: [2, 3] },
  size_guide: { weight: 12, messageRange: [3, 4] },
  return_exchange: {
    weight: 10,
    messageRange: [4, 5],
    preferredStatus: "escalated",
  },
  delivery_inquiry: { weight: 10, messageRange: [2, 3] },
  cart_abandonment: {
    weight: 8,
    messageRange: [2, 3],
    preferredStatus: "abandoned",
  },
  complaint: { weight: 5, messageRange: [3, 5], preferredStatus: "escalated" },
  multi_item_purchase: { weight: 5, messageRange: [7, 10] },
};

const SCENARIO_WEIGHTS = Object.entries(SCENARIOS).map(([id, cfg]) => ({
  value: id as ScenarioId,
  weight: cfg.weight,
}));

// ============================================================================
// Message generation helpers
// ============================================================================

const CONNECTOR_SLUG = "acme";

/** Tool names follow convention: {connector_slug}_{tool_slug} */
function toolName(catalogName: string): string {
  return `${CONNECTOR_SLUG}_${catalogName.toLowerCase().replace(/\s+/g, "_")}`;
}

interface GeneratedMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown>;
  modelUsed?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

function assistantMsg(content: string): GeneratedMessage {
  const model = pick(MODELS);
  return {
    role: "assistant",
    content,
    modelUsed: model,
    tokensUsed: randInt(50, 400),
    latencyMs: randInt(200, 1500),
  };
}

function userMsg(content: string): GeneratedMessage {
  return { role: "user", content };
}

function toolCallMsg(
  name: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): [GeneratedMessage, GeneratedMessage] {
  const callId = `call_${uuid().replace(/-/g, "").slice(0, 24)}`;
  const model = pick(MODELS);
  return [
    {
      role: "assistant",
      content: null,
      toolCallId: callId,
      toolName: toolName(name),
      toolInput: input,
      modelUsed: model,
      tokensUsed: randInt(30, 150),
      latencyMs: randInt(100, 800),
    },
    {
      role: "tool",
      content: null,
      toolCallId: callId,
      toolName: toolName(name),
      toolOutput: output,
      latencyMs: randInt(50, 500),
    },
  ];
}

function generateProductListOutput(products: Product[]) {
  return {
    products: products.map((p) => ({
      id: p.id,
      title: p.name,
      category: p.category,
      brand: p.brand,
      price: { amount: p.price * 100, currency_code: "USD" },
      variants: p.sizes.map((size, i) => ({
        id: `var_${p.id}_${i}`,
        title: `${size} / ${pick(p.colors)}`,
        inventory_quantity: randInt(0, 50),
      })),
    })),
    count: products.length,
  };
}

function generateProductDetailOutput(product: Product) {
  return {
    id: product.id,
    title: product.name,
    description: `${product.brand} ${product.name} — available sizes: ${product.sizes.join(", ")}`,
    category: product.category,
    brand: product.brand,
    price: { amount: product.price * 100, currency_code: "USD" },
    variants: product.sizes.map((size, i) => ({
      id: `var_${product.id}_${i}`,
      title: `${size} / ${pick(product.colors)}`,
      prices: [{ amount: product.price * 100, currency_code: "USD" }],
      inventory_quantity: randInt(0, 50),
    })),
    images: [{ url: `https://cdn.acme-store.com/products/${product.id}_1.jpg` }],
  };
}

// ============================================================================
// Scenario message generators
// ============================================================================

function genProductInquiry(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const size = pick(p.sizes);
  const color = pick(p.colors);
  const msgs: GeneratedMessage[] = [];

  msgs.push(
    userMsg(`Hi, do you have the ${p.name} in ${color}, size ${size}?`),
  );
  msgs.push(
    ...toolCallMsg(
      "List Products",
      { q: p.name },
      generateProductListOutput([p]),
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Get Product",
      { productId: p.id },
      generateProductDetailOutput(p),
    ),
  );
  msgs.push(
    assistantMsg(
      `Yes, we have the ${p.name} by ${p.brand} in size ${size}. It's priced at $${p.price}. The ${color} color is available. Would you like to add it to your cart?`,
    ),
  );
  if (rand() > 0.5) {
    msgs.push(userMsg("Thanks for the info, I need to think about it."));
    msgs.push(
      assistantMsg(
        "Of course! If you have any questions, feel free to reach out. Have a great day!",
      ),
    );
  }
  return msgs;
}

function genBrowseAndPurchase(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const size = pick(p.sizes);
  const color = pick(p.colors);
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const city = pick(CITIES);
  const cityIdx = CITIES.indexOf(city);
  const zipCode = ZIP_CODES[cityIdx] || "10001";
  const street = pick(STREETS);
  const cartId = `cart_${uuid().slice(0, 8)}`;
  const variantId = `var_${p.id}_${randInt(0, p.sizes.length - 1)}`;
  const orderId = `order_${uuid().slice(0, 8)}`;

  const msgs: GeneratedMessage[] = [];
  msgs.push(
    userMsg(
      `I'm looking for ${p.category} as a gift. Something elegant under $${p.price < 80 ? "80" : "150"}.`,
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "List Products",
      { q: p.category, limit: 5 },
      generateProductListOutput([p, pick(PRODUCTS)]),
    ),
  );
  msgs.push(
    assistantMsg(
      `I'd recommend the ${p.name} by ${p.brand} for $${p.price}. Available colors: ${p.colors.join(", ")}. Would you like to see the details?`,
    ),
  );
  msgs.push(userMsg(`Yes, I'd like ${color} in size ${size}.`));
  msgs.push(
    ...toolCallMsg(
      "Get Product",
      { productId: p.id },
      generateProductDetailOutput(p),
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Create Cart",
      { regionId: "reg_us", currencyCode: "USD" },
      { cart: { id: cartId } },
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Add to Cart",
      { cartId, variantId, quantity: 1 },
      {
        cart: {
          id: cartId,
          items: [
            {
              variant_id: variantId,
              quantity: 1,
              unit_price: p.price * 100,
            },
          ],
          total: p.price * 100,
        },
      },
    ),
  );
  msgs.push(
    assistantMsg(
      `I've added the ${p.name} (${size}, ${color}) to your cart. Total: $${p.price}. Would you like to provide a shipping address?`,
    ),
  );
  msgs.push(
    userMsg(
      `Yes, ${firstName} ${lastName}, ${randInt(1, 9999)} ${street}, ${city} ${zipCode}`,
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Set Delivery Address",
      {
        cartId,
        address: {
          firstName,
          lastName,
          address1: `${randInt(1, 9999)} ${street}`,
          city,
          zipCode,
          countryCode: "US",
        },
      },
      {
        cart: {
          id: cartId,
          shipping_address: { city, zip_code: zipCode },
        },
      },
    ),
  );
  msgs.push(assistantMsg("Address saved. Shall I confirm the order?"));
  msgs.push(userMsg("Yes, confirm it."));
  msgs.push(
    ...toolCallMsg(
      "Complete Cart",
      { cartId },
      {
        type: "order",
        order: {
          id: orderId,
          status: "pending",
          display_id: randInt(10000, 99999),
        },
      },
    ),
  );
  msgs.push(
    assistantMsg(
      `Order placed! Order number: ${orderId}. Confirmation sent to your email. Thank you for shopping with ACME!`,
    ),
  );
  return msgs;
}

function genOrderStatus(): GeneratedMessage[] {
  const orderId = `order_${uuid().slice(0, 8)}`;
  const msgs: GeneratedMessage[] = [];
  msgs.push(userMsg(`I'd like to check the status of my order ${orderId}`));
  msgs.push(
    assistantMsg(
      "Unfortunately, I don't have direct access to the shipment tracking system. Please check your order status at acme-store.com/my-orders or provide the tracking number from your confirmation email. Can I help with anything else?",
    ),
  );
  if (rand() > 0.4) {
    msgs.push(userMsg("When can I expect delivery?"));
    msgs.push(
      assistantMsg(
        "Standard delivery takes 2-4 business days. If your order was placed more than 5 days ago and hasn't arrived, please contact our support team at support@acme-store.com.",
      ),
    );
  }
  return msgs;
}

function genSizeGuide(): GeneratedMessage[] {
  const p = pick(
    PRODUCTS.filter((p) => p.sizes.length > 1 && p.sizes[0] !== "one size"),
  );
  const msgs: GeneratedMessage[] = [];
  msgs.push(
    userMsg(
      `I usually wear size ${pick(["S", "M", "8", "10"])} in other brands. What size should I pick for the ${p.name}?`,
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Get Product",
      { productId: p.id },
      generateProductDetailOutput(p),
    ),
  );
  msgs.push(
    assistantMsg(
      `The ${p.brand} ${p.name} has a standard fit. I'd recommend size ${pick(p.sizes)}. The size chart is available on the product page. Would you like to add it to your cart?`,
    ),
  );
  if (rand() > 0.3) {
    msgs.push(userMsg("Thanks, I'll take that size!"));
    msgs.push(
      assistantMsg("Great choice! Shall I add it to your cart?"),
    );
  }
  return msgs;
}

function genReturnExchange(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const orderId = `order_${uuid().slice(0, 8)}`;
  const msgs: GeneratedMessage[] = [];
  msgs.push(
    userMsg(
      `I'd like to return the ${p.name} from order ${orderId}. The size is too big.`,
    ),
  );
  msgs.push(
    assistantMsg(
      "I understand. Returns are available within 30 days of receiving your order. Would you like an exchange for a smaller size or a full refund?",
    ),
  );
  msgs.push(userMsg("I'd like an exchange for a smaller size."));
  msgs.push(
    assistantMsg(
      "An exchange requires assistance from our support team. I'm transferring your case to an agent who can help with the exchange. Please hold on.",
    ),
  );
  if (rand() > 0.5) {
    msgs.push(userMsg("OK, I'll wait."));
  }
  return msgs;
}

function genDeliveryInquiry(): GeneratedMessage[] {
  const msgs: GeneratedMessage[] = [];
  const questions = [
    "How much does international shipping cost?",
    "Can I pick up my order in store?",
    "How long does express delivery take?",
    "Is there free shipping above a certain amount?",
    "Do you ship to Canada?",
  ];
  msgs.push(userMsg(pick(questions)));
  msgs.push(
    assistantMsg(
      "We offer several shipping options:\n- Standard shipping: $5.99 (3-5 business days)\n- Express shipping: $12.99 (1-2 business days)\n- Free shipping on orders over $75\n- International shipping: from $19.99\n\nCan I help with anything else?",
    ),
  );
  if (rand() > 0.6) {
    msgs.push(userMsg("Thanks, that's all!"));
    msgs.push(assistantMsg("Happy shopping!"));
  }
  return msgs;
}

function genCartAbandonment(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const msgs: GeneratedMessage[] = [];
  msgs.push(userMsg(`Show me your ${p.category}`));
  msgs.push(
    ...toolCallMsg(
      "List Products",
      { q: p.category, limit: 5 },
      generateProductListOutput(
        PRODUCTS.filter((x) => x.category === p.category).slice(0, 3),
      ),
    ),
  );
  msgs.push(
    assistantMsg(
      `Here are our ${p.category}:\n${PRODUCTS.filter(
        (x) => x.category === p.category,
      )
        .slice(0, 3)
        .map((x) => `• ${x.name} — $${x.price}`)
        .join("\n")}\n\nWould you like to see details on any of these?`,
    ),
  );
  // User abandons — no more messages
  return msgs;
}

function genComplaint(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const msgs: GeneratedMessage[] = [];
  const complaints = [
    `I received a damaged product — the ${p.name} has a stain on it. This is unacceptable!`,
    `I ordered the ${p.name} 2 weeks ago and it still hasn't arrived. What's going on?`,
    `I received the wrong color for the ${p.name}. I ordered black but got grey!`,
    `The quality of the ${p.name} is very poor for $${p.price}. I want a refund!`,
  ];
  msgs.push(userMsg(pick(complaints)));
  msgs.push(
    assistantMsg(
      "I'm very sorry about this situation. I completely understand your frustration. I want to resolve this as quickly as possible. I'm escalating your case to our claims specialist who will contact you within 24 hours.",
    ),
  );
  if (rand() > 0.4) {
    msgs.push(userMsg("I want to speak with a manager!"));
    msgs.push(
      assistantMsg(
        "Of course, I'm transferring you to our customer service manager. Please hold on.",
      ),
    );
  }
  if (rand() > 0.6) {
    msgs.push(userMsg("I'm also leaving a review on Google."));
  }
  return msgs;
}

function genMultiItemPurchase(): GeneratedMessage[] {
  const items = [pick(PRODUCTS), pick(PRODUCTS), pick(PRODUCTS)].filter(
    (p, i, a) => a.findIndex((x) => x.id === p.id) === i,
  );
  if (items.length < 2) items.push(PRODUCTS[0]);
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const city = pick(CITIES);
  const cityIdx = CITIES.indexOf(city);
  const zipCode = ZIP_CODES[cityIdx] || "10001";
  const cartId = `cart_${uuid().slice(0, 8)}`;
  const orderId = `order_${uuid().slice(0, 8)}`;
  let total = 0;

  const msgs: GeneratedMessage[] = [];
  msgs.push(userMsg("I'd like to buy a few things. Can you help?"));
  msgs.push(
    assistantMsg(
      "Of course! Tell me what you're looking for and I'll help you find the perfect items.",
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Create Cart",
      { regionId: "reg_us", currencyCode: "USD" },
      { cart: { id: cartId } },
    ),
  );

  for (const item of items) {
    const size = pick(item.sizes);
    const variantId = `var_${item.id}_${randInt(0, item.sizes.length - 1)}`;
    total += item.price;

    msgs.push(userMsg(`Add the ${item.name} in size ${size}`));
    msgs.push(
      ...toolCallMsg(
        "Add to Cart",
        { cartId, variantId, quantity: 1 },
        {
          cart: {
            id: cartId,
            items_count: items.indexOf(item) + 1,
            total: total * 100,
          },
        },
      ),
    );
    msgs.push(
      assistantMsg(`Added ${item.name} (${size}). Total: $${total}.`),
    );
  }

  msgs.push(
    userMsg(
      `OK, I'd like to order. Address: ${firstName} ${lastName}, ${randInt(1, 9999)} ${pick(STREETS)}, ${city} ${zipCode}`,
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Set Delivery Address",
      {
        cartId,
        address: {
          firstName,
          lastName,
          address1: `${randInt(1, 9999)} ${pick(STREETS)}`,
          city,
          zipCode,
          countryCode: "US",
        },
      },
      { cart: { id: cartId, shipping_address: { city } } },
    ),
  );
  msgs.push(
    assistantMsg(
      `Shipping address set. Total: $${total}. Shall I confirm the order?`,
    ),
  );
  msgs.push(userMsg("Yes, confirm!"));
  msgs.push(
    ...toolCallMsg(
      "Complete Cart",
      { cartId },
      {
        type: "order",
        order: {
          id: orderId,
          status: "pending",
          display_id: randInt(10000, 99999),
        },
      },
    ),
  );
  msgs.push(
    assistantMsg(
      `Order ${orderId} has been placed! Total: $${total}. Thank you for shopping with us!`,
    ),
  );
  return msgs;
}

const SCENARIO_GENERATORS: Record<ScenarioId, () => GeneratedMessage[]> = {
  product_inquiry: genProductInquiry,
  browse_and_purchase: genBrowseAndPurchase,
  order_status: genOrderStatus,
  size_guide: genSizeGuide,
  return_exchange: genReturnExchange,
  delivery_inquiry: genDeliveryInquiry,
  cart_abandonment: genCartAbandonment,
  complaint: genComplaint,
  multi_item_purchase: genMultiItemPurchase,
};

// ============================================================================
// Time distribution helpers
// ============================================================================

/** Hourly weight distribution for an online fashion store (EST) */
const HOURLY_WEIGHTS = [
  /* 00 */ 2, /* 01 */ 1, /* 02 */ 0.5, /* 03 */ 0.3, /* 04 */ 0.3,
  /* 05 */ 0.5, /* 06 */ 1, /* 07 */ 2, /* 08 */ 4, /* 09 */ 6, /* 10 */ 8,
  /* 11 */ 9, /* 12 */ 8, /* 13 */ 9, /* 14 */ 10, /* 15 */ 10, /* 16 */ 9,
  /* 17 */ 9, /* 18 */ 10, /* 19 */ 10, /* 20 */ 8, /* 21 */ 6, /* 22 */ 4,
  /* 23 */ 3,
];
const HOURLY_TOTAL = HOURLY_WEIGHTS.reduce((a, b) => a + b, 0);

function pickHour(): number {
  let r = rand() * HOURLY_TOTAL;
  for (let h = 0; h < 24; h++) {
    r -= HOURLY_WEIGHTS[h];
    if (r <= 0) return h;
  }
  return 12;
}

function generateSessionTimestamp(now: Date, daysAgo: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  const hour = pickHour();
  date.setHours(hour, randInt(0, 59), randInt(0, 59), randInt(0, 999));
  return date;
}

// ============================================================================
// User identifier generation
// ============================================================================

function generatePhoneNumber(): string {
  return `+1 ${randInt(200, 999)}-${randInt(200, 999)}-${randInt(1000, 9999)}`;
}

function generateEmail(): string {
  const first = pick(FIRST_NAMES).toLowerCase();
  const last = pick(LAST_NAMES).toLowerCase();
  const domains = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "icloud.com",
    "hotmail.com",
    "proton.me",
  ];
  return `${first}.${last}${randInt(1, 99)}@${pick(domains)}`;
}

function generateUserMetadata(): Record<string, unknown> {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const isReturning = rand() > 0.4;
  return {
    name: `${firstName} ${lastName}`,
    locale: "pl-PL",
    returning_customer: isReturning,
    order_count: isReturning ? randInt(1, 25) : 0,
    city: pick(CITIES),
  };
}

// ============================================================================
// Feedback generation
// ============================================================================

interface GeneratedFeedback {
  rating: number;
  feedbackSource: "customer" | "support";
  feedbackTags: string[];
  comment: string | null;
  userIdentifier: string | null;
}

function generateFeedback(
  status: string,
  userIdentifier: string | null,
): GeneratedFeedback[] {
  const results: GeneratedFeedback[] = [];
  if (status !== "completed") return results;

  // ~60% of completed sessions get customer feedback
  if (rand() < 0.6) {
    const isPositive = rand() < 0.78;
    const tags = isPositive ? POSITIVE_FEEDBACK_TAGS : NEGATIVE_FEEDBACK_TAGS;
    const selectedTags = tags.filter(() => rand() > 0.5);
    if (selectedTags.length === 0) selectedTags.push(tags[0]);

    results.push({
      rating: isPositive ? 2 : 1,
      feedbackSource: "customer",
      feedbackTags: selectedTags,
      comment:
        rand() < 0.2
          ? pick(isPositive ? POSITIVE_COMMENTS : NEGATIVE_COMMENTS)
          : null,
      userIdentifier,
    });
  }

  // ~30% of completed sessions get support feedback
  if (rand() < 0.3) {
    const isPositive = rand() < 0.7;
    const tags = isPositive ? POSITIVE_FEEDBACK_TAGS : NEGATIVE_FEEDBACK_TAGS;
    const selectedTags = tags.filter(() => rand() > 0.5);
    if (selectedTags.length === 0) selectedTags.push(tags[0]);

    results.push({
      rating: isPositive ? 2 : 1,
      feedbackSource: "support",
      feedbackTags: selectedTags,
      comment:
        rand() < 0.15
          ? pick(isPositive ? POSITIVE_COMMENTS : NEGATIVE_COMMENTS)
          : null,
      userIdentifier: null,
    });
  }

  return results;
}

// ============================================================================
// Main seed logic
// ============================================================================

async function setupAcmeOrg(db: SeedDb) {
  console.log("Setting up ACME organization...\n");

  // 1. Create org
  const [orgRow] = await db
    .insert(organizations)
    .values({
      name: "ACME",
      slug: "acme",
      settings: {
        timezone: "America/New_York",
        features: ["voice-agents", "chat-agents"],
      },
    })
    .onConflictDoNothing()
    .returning();

  const org =
    orgRow ||
    (await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.slug, "acme"),
    }));

  if (!org) throw new Error("Failed to create/find ACME organization");
  console.log(`  Org: ${org.name} (${org.id})`);

  // 2. Create users
  const adminEmail = "delivered+admin-acme@resend.dev";
  const supportEmail = "delivered+support-acme@resend.dev";

  const [adminRow] = await db
    .insert(users)
    .values([
      {
        organizationId: org.id,
        email: adminEmail,
        name: "ACME Admin",
        role: "admin",
        isActive: true,
      },
      {
        organizationId: org.id,
        email: supportEmail,
        name: "ACME Support",
        role: "support",
        isActive: true,
      },
    ])
    .onConflictDoNothing()
    .returning();

  const admin =
    adminRow ||
    (await db.query.users.findFirst({
      where: (u, { eq, and }) =>
        and(eq(u.organizationId, org.id), eq(u.email, adminEmail)),
    }));

  if (!admin) throw new Error("Failed to create/find admin user");
  console.log(`  Admin: ${admin.email}`);

  // 3. Get Medusa catalog
  const medusaCatalog = await db.query.connectorsCatalog.findFirst({
    where: (cat, { eq }) => eq(cat.slug, "medusa"),
  });
  if (!medusaCatalog)
    throw new Error("Medusa catalog not found — run `make db-seed` first");

  // 4. Create connector
  const [connRow] = await db
    .insert(connectors)
    .values({
      organizationId: org.id,
      connectorCatalogId: medusaCatalog.id,
      name: "ACME Store",
      slug: "acme",
      config: {
        baseUrl: "https://api.acme-store.com",
        publishableKey: "pk_acme_prod",
      },
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const connector =
    connRow ||
    (await db.query.connectors.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.organizationId, org.id), eq(c.slug, "acme")),
    }));
  if (!connector) throw new Error("Failed to create/find ACME connector");
  console.log(`  Connector: ${connector.name}`);

  // 5. Create connector tools from catalog
  type CatalogToolType = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    defaultTimeoutSeconds?: number;
  };
  if (medusaCatalog.tools && Array.isArray(medusaCatalog.tools)) {
    const toolValues = (medusaCatalog.tools as CatalogToolType[]).map(
      (tool) => ({
        organizationId: org.id,
        connectorId: connector.id,
        name: tool.name,
        slug: tool.name.toLowerCase().replace(/\s+/g, "_"),
        description: tool.description,
        toolSchema: tool.inputSchema,
        timeoutSeconds: tool.defaultTimeoutSeconds || 30,
        isActive: true,
      }),
    );
    const inserted = await db
      .insert(connectorTools)
      .values(toolValues)
      .onConflictDoNothing()
      .returning();
    console.log(`  Created ${inserted.length} connector tools`);
  }

  // 6. Create agent
  const agentName = "ACME Shopping Assistant";
  const [agentRow] = await db
    .insert(agents)
    .values({
      organizationId: org.id,
      name: agentName,
      description: "AI shopping assistant for ACME fashion store",
      agentType: "voice",
      isActive: true,
      createdBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();

  const agent =
    agentRow ||
    (await db.query.agents.findFirst({
      where: (a, { eq, and }) =>
        and(eq(a.organizationId, org.id), eq(a.name, agentName)),
    }));
  if (!agent) throw new Error("Failed to create/find agent");
  console.log(`  Agent: ${agent.name}`);

  // 7. Create API key
  const { key, hash, prefix } = generateApiKey();
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      organizationId: org.id,
      agentId: agent.id,
      name: "ACME Production Key",
      keyHash: hash,
      keyPrefix: prefix,
      isActive: true,
      createdBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();
  if (apiKey) {
    console.log(`  API Key: ${key}`);
  }

  // 8. Link tools to agent
  const tools = await db.query.connectorTools.findMany({
    where: (t, { eq }) => eq(t.connectorId, connector.id),
  });
  const linkValues = tools.map((tool) => ({
    agentId: agent.id,
    connectorToolId: tool.id,
    isEnabled: true,
    requiresConfirmation: tool.name.toLowerCase().includes("complete"),
  }));
  const linked = await db
    .insert(agentConnectorTools)
    .values(linkValues)
    .onConflictDoNothing()
    .returning();
  console.log(`  Linked ${linked.length} tools to agent`);

  return { orgId: org.id, agentId: agent.id };
}

async function generateAndInsertSessions(
  db: SeedDb,
  orgId: string,
  agentId: string,
) {
  const now = new Date();
  const totalDays = MONTHS_BACK * 30;
  const sessionsPerDay = TOTAL_SESSIONS / totalDays;

  // Pre-calculate how many sessions per day
  const dailyCounts: number[] = [];
  let totalAllocated = 0;
  for (let d = 0; d < totalDays; d++) {
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() - d);
    const dayOfWeek = dayDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const base = sessionsPerDay * (isWeekend ? 0.8 : 1.05);
    // Add some daily variance ±15%
    const count = Math.round(base * (0.85 + rand() * 0.3));
    dailyCounts.push(count);
    totalAllocated += count;
  }

  // Adjust last day to hit target
  const diff = TOTAL_SESSIONS - totalAllocated;
  dailyCounts[0] = Math.max(1, dailyCounts[0] + diff);

  console.log(
    `\nGenerating ${TOTAL_SESSIONS.toLocaleString()} sessions over ${totalDays} days...`,
  );

  const SESSION_BATCH = 500;
  const MESSAGE_BATCH = 2000;
  const FEEDBACK_BATCH = 1000;

  let sessionBuf: Array<{
    id: string;
    organizationId: string;
    agentId: string;
    channelType: "web" | "widget" | "whatsapp" | "voice" | "email" | "sms";
    status: "active" | "completed" | "escalated" | "abandoned";
    userIdentifier: string | null;
    userMetadata: Record<string, unknown>;
    startedAt: Date;
    endedAt: Date | null;
    metadata: Record<string, unknown>;
  }> = [];

  let messageBuf: Array<{
    id: string;
    sessionId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string | null;
    toolCallId: string | null;
    toolName: string | null;
    toolInput: Record<string, unknown> | null;
    toolOutput: Record<string, unknown> | null;
    modelUsed: string | null;
    tokensUsed: number | null;
    latencyMs: number | null;
    createdAt: Date;
    occurredAt: Date;
  }> = [];

  let feedbackBuf: Array<{
    id: string;
    sessionId: string;
    rating: number;
    feedbackSource: "customer" | "support";
    feedbackTags: string[];
    comment: string | null;
    userIdentifier: string | null;
    feedbackRef: string;
    createdAt: Date;
  }> = [];

  let totalSessions = 0;
  let totalMessages = 0;
  let totalFeedback = 0;

  const flushSessions = async () => {
    if (sessionBuf.length === 0) return;
    await db.insert(sessions).values(sessionBuf).onConflictDoNothing();
    sessionBuf = [];
  };

  const flushMessages = async () => {
    if (messageBuf.length === 0) return;
    await db.insert(sessionMessages).values(messageBuf).onConflictDoNothing();
    messageBuf = [];
  };

  const flushFeedback = async () => {
    if (feedbackBuf.length === 0) return;
    await db.insert(sessionFeedback).values(feedbackBuf).onConflictDoNothing();
    feedbackBuf = [];
  };

  for (let d = 0; d < totalDays; d++) {
    const count = dailyCounts[d];
    const isToday = d === 0;

    for (let s = 0; s < count; s++) {
      const sessionId = uuid();
      const startedAt = generateSessionTimestamp(now, d);

      // Pick scenario
      const scenarioId = weightedPick(SCENARIO_WEIGHTS);
      const scenario = SCENARIOS[scenarioId];

      // Determine status
      let status: "active" | "completed" | "escalated" | "abandoned";
      if (isToday && rand() < 0.05) {
        status = "active";
      } else if (scenario.preferredStatus && rand() < 0.7) {
        status = scenario.preferredStatus;
      } else {
        status = weightedPick(isToday ? STATUS_WEIGHTS : STATUS_WEIGHTS_PAST);
        // Don't assign 'active' to past sessions
        if (!isToday && status === "active") status = "completed";
      }

      // Duration based on status
      let durationSec: number;
      switch (status) {
        case "completed":
          durationSec = randInt(120, 600);
          break;
        case "escalated":
          durationSec = randInt(60, 300);
          break;
        case "abandoned":
          durationSec = randInt(30, 180);
          break;
        default:
          durationSec = 0; // active — no end
      }

      const endedAt =
        status === "active"
          ? null
          : new Date(startedAt.getTime() + durationSec * 1000);
      const channel = weightedPick(CHANNEL_WEIGHTS);
      const usePhone = rand() < 0.5;
      const userIdentifier = usePhone ? generatePhoneNumber() : generateEmail();
      const userMetadata = generateUserMetadata();

      sessionBuf.push({
        id: sessionId,
        organizationId: orgId,
        agentId,
        channelType: channel,
        status,
        userIdentifier,
        userMetadata,
        startedAt,
        endedAt,
        metadata: { scenario: scenarioId, channel },
      });

      // Generate messages
      const msgs = SCENARIO_GENERATORS[scenarioId]();
      const msgInterval =
        durationSec > 0
          ? (durationSec * 1000) / Math.max(msgs.length, 1)
          : 5000;

      for (let m = 0; m < msgs.length; m++) {
        const msg = msgs[m];
        const occurredAt = new Date(
          startedAt.getTime() + msgInterval * m + randInt(0, 1000),
        );

        messageBuf.push({
          id: uuid(),
          sessionId,
          role: msg.role,
          content: msg.content,
          toolCallId: msg.toolCallId || null,
          toolName: msg.toolName || null,
          toolInput: msg.toolInput || null,
          toolOutput: msg.toolOutput || null,
          modelUsed: msg.modelUsed || null,
          tokensUsed: msg.tokensUsed || null,
          latencyMs: msg.latencyMs || null,
          createdAt: occurredAt,
          occurredAt,
        });
        totalMessages++;

        if (messageBuf.length >= MESSAGE_BATCH) {
          // Flush sessions first to satisfy FK constraints
          await flushSessions();
          await flushMessages();
        }
      }

      // Generate feedback
      const feedbacks = generateFeedback(status, userIdentifier);
      for (let fi = 0; fi < feedbacks.length; fi++) {
        const fb = feedbacks[fi];
        const fbCreatedAt = endedAt
          ? new Date(endedAt.getTime() + randInt(60_000, 3_600_000))
          : new Date(startedAt.getTime() + 600_000);

        feedbackBuf.push({
          id: uuid(),
          sessionId,
          rating: fb.rating,
          feedbackSource: fb.feedbackSource,
          feedbackTags: fb.feedbackTags,
          comment: fb.comment,
          userIdentifier: fb.userIdentifier,
          feedbackRef: `${fb.feedbackSource}_${fi}`,
          createdAt: fbCreatedAt,
        });
        totalFeedback++;

        if (feedbackBuf.length >= FEEDBACK_BATCH) {
          await flushSessions();
          await flushFeedback();
        }
      }

      totalSessions++;

      if (sessionBuf.length >= SESSION_BATCH) {
        await flushSessions();
      }

      if (totalSessions % 5000 === 0) {
        console.log(
          `  Progress: ${totalSessions.toLocaleString()} sessions, ${totalMessages.toLocaleString()} messages, ${totalFeedback.toLocaleString()} feedback`,
        );
      }
    }
  }

  // Flush remaining
  await flushSessions();
  await flushMessages();
  await flushFeedback();

  console.log("\nDone!");
  console.log(`  Sessions:  ${totalSessions.toLocaleString()}`);
  console.log(`  Messages:  ${totalMessages.toLocaleString()}`);
  console.log(`  Feedback:  ${totalFeedback.toLocaleString()}`);
}

// ============================================================================
// Entry point
// ============================================================================

async function main() {
  const connectionString =
    process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("DATABASE_MIGRATION_URL or DATABASE_URL must be set");
    process.exit(1);
  }

  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient, { schema });

  try {
    console.log("=== Synthetic Session Data Seed ===\n");

    const { orgId, agentId } = await setupAcmeOrg(db);
    await generateAndInsertSessions(db, orgId, agentId);

    console.log("\n=== Seed complete ===");
    console.log("Login as: delivered+admin-acme@resend.dev");
  } finally {
    await queryClient.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
