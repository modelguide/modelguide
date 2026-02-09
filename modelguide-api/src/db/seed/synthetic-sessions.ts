/**
 * Synthetic session data seed script
 *
 * Generates ~100k realistic e-commerce sessions for a Polish fashion store
 * modeled after estyl.pl. Data spans ~10 months back at ~10k sessions/month.
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

const POLISH_FIRST_NAMES = [
  "Anna",
  "Katarzyna",
  "Magdalena",
  "Agnieszka",
  "Joanna",
  "Monika",
  "Ewa",
  "Marta",
  "Aleksandra",
  "Natalia",
  "Patrycja",
  "Karolina",
  "Izabela",
  "Dorota",
  "Beata",
  "Piotr",
  "Krzysztof",
  "Tomasz",
  "Marcin",
  "Paweł",
  "Jakub",
  "Adam",
  "Łukasz",
  "Michał",
  "Dawid",
  "Kamil",
  "Rafał",
  "Marek",
  "Robert",
  "Grzegorz",
];

const POLISH_LAST_NAMES = [
  "Nowak",
  "Kowalski",
  "Wiśniewski",
  "Wójcik",
  "Kowalczyk",
  "Kamiński",
  "Lewandowski",
  "Zieliński",
  "Szymański",
  "Woźniak",
  "Dąbrowski",
  "Kozłowski",
  "Jankowski",
  "Mazur",
  "Wojciechowski",
  "Kwiatkowski",
  "Krawczyk",
  "Kaczmarek",
  "Piotrowska",
  "Grabowska",
];

const CITIES = [
  "Warszawa",
  "Kraków",
  "Łódź",
  "Wrocław",
  "Poznań",
  "Gdańsk",
  "Szczecin",
  "Bydgoszcz",
  "Lublin",
  "Białystok",
  "Katowice",
  "Gdynia",
  "Częstochowa",
  "Radom",
  "Toruń",
];

const POSTAL_CODES = [
  "00-001",
  "02-515",
  "30-001",
  "50-001",
  "60-001",
  "80-001",
  "70-001",
  "85-001",
  "20-001",
  "15-001",
  "40-001",
  "81-001",
  "42-200",
  "26-600",
  "87-100",
];

const STREETS = [
  "ul. Marszałkowska",
  "ul. Nowy Świat",
  "ul. Floriańska",
  "ul. Piotrkowska",
  "ul. Świdnicka",
  "ul. Półwiejska",
  "ul. Długa",
  "ul. Kościuszki",
  "al. Jerozolimskie",
  "ul. Grodzka",
  "ul. Świętokrzyska",
  "ul. Piłsudskiego",
];

interface Product {
  id: string;
  name: string;
  category: string;
  brand: string;
  pricePLN: number;
  sizes: string[];
  colors: string[];
}

const PRODUCTS: Product[] = [
  {
    id: "prod_dress_01",
    name: "Sukienka midi z falbanami",
    category: "sukienki",
    brand: "Reserved",
    pricePLN: 189,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["czarny", "czerwony", "granatowy"],
  },
  {
    id: "prod_dress_02",
    name: "Sukienka koktajlowa satynowa",
    category: "sukienki",
    brand: "Mohito",
    pricePLN: 249,
    sizes: ["XS", "S", "M", "L"],
    colors: ["butelkowa zieleń", "bordowy", "czarny"],
  },
  {
    id: "prod_dress_03",
    name: "Sukienka maxi w kwiaty",
    category: "sukienki",
    brand: "Sinsay",
    pricePLN: 119,
    sizes: ["S", "M", "L", "XL"],
    colors: ["wielokolorowy", "biały"],
  },
  {
    id: "prod_shoe_01",
    name: "Szpilki lakierowane",
    category: "buty",
    brand: "CCC",
    pricePLN: 179,
    sizes: ["36", "37", "38", "39", "40"],
    colors: ["czarny", "nude", "czerwony"],
  },
  {
    id: "prod_shoe_02",
    name: "Sneakersy platformowe",
    category: "buty",
    brand: "Nike",
    pricePLN: 449,
    sizes: ["36", "37", "38", "39", "40", "41", "42"],
    colors: ["biały", "czarny", "różowy"],
  },
  {
    id: "prod_shoe_03",
    name: "Botki na obcasie",
    category: "buty",
    brand: "Ryłko",
    pricePLN: 399,
    sizes: ["36", "37", "38", "39", "40"],
    colors: ["czarny", "brązowy", "beżowy"],
  },
  {
    id: "prod_bag_01",
    name: "Torebka shopperka skórzana",
    category: "torebki",
    brand: "Batycki",
    pricePLN: 329,
    sizes: ["one size"],
    colors: ["czarny", "brązowy", "camel"],
  },
  {
    id: "prod_bag_02",
    name: "Listonoszka pikowana",
    category: "torebki",
    brand: "Guess",
    pricePLN: 549,
    sizes: ["one size"],
    colors: ["czarny", "biały", "różowy"],
  },
  {
    id: "prod_jacket_01",
    name: "Ramoneska skórzana",
    category: "kurtki",
    brand: "Zara",
    pricePLN: 349,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["czarny"],
  },
  {
    id: "prod_jacket_02",
    name: "Płaszcz wełniany oversize",
    category: "kurtki",
    brand: "H&M",
    pricePLN: 499,
    sizes: ["S", "M", "L", "XL"],
    colors: ["beżowy", "szary", "czarny"],
  },
  {
    id: "prod_sweater_01",
    name: "Sweter oversizowy z wełny",
    category: "swetry",
    brand: "Reserved",
    pricePLN: 159,
    sizes: ["S/M", "L/XL"],
    colors: ["ecru", "szary", "morelowy"],
  },
  {
    id: "prod_sweater_02",
    name: "Golf kaszmirowy",
    category: "swetry",
    brand: "Massimo Dutti",
    pricePLN: 599,
    sizes: ["XS", "S", "M", "L"],
    colors: ["czarny", "camel", "granatowy"],
  },
  {
    id: "prod_jeans_01",
    name: "Jeansy mom fit high waist",
    category: "jeansy",
    brand: "Levi's",
    pricePLN: 399,
    sizes: ["24", "25", "26", "27", "28", "29", "30", "31"],
    colors: ["jasny niebieski", "ciemny niebieski"],
  },
  {
    id: "prod_jeans_02",
    name: "Jeansy wide leg",
    category: "jeansy",
    brand: "Pull & Bear",
    pricePLN: 149,
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["niebieski", "czarny"],
  },
  {
    id: "prod_acc_01",
    name: "Szalik kaszmirowy",
    category: "akcesoria",
    brand: "Weekend Max Mara",
    pricePLN: 699,
    sizes: ["one size"],
    colors: ["beżowy", "szary", "czarny"],
  },
  {
    id: "prod_acc_02",
    name: "Pasek skórzany z klamrą",
    category: "akcesoria",
    brand: "Tommy Hilfiger",
    pricePLN: 249,
    sizes: ["S", "M", "L"],
    colors: ["czarny", "brązowy"],
  },
  {
    id: "prod_sneaker_01",
    name: "Buty sportowe do biegania",
    category: "sneakersy",
    brand: "adidas",
    pricePLN: 499,
    sizes: ["38", "39", "40", "41", "42", "43", "44", "45"],
    colors: ["czarny/biały", "szary/niebieski"],
  },
  {
    id: "prod_sneaker_02",
    name: "Sneakersy retro '90s",
    category: "sneakersy",
    brand: "New Balance",
    pricePLN: 549,
    sizes: ["36", "37", "38", "39", "40", "41", "42", "43"],
    colors: ["szary", "granatowy", "zielony"],
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
  "Szybka i pomocna obsługa!",
  "Świetna pomoc przy wyborze rozmiaru",
  "Agent bardzo dobrze doradził",
  "Zakupy poszły sprawnie, polecam",
  "Bardzo miła rozmowa, dziękuję",
  "Great help with my order",
  "Quick and efficient service",
  "Resolved my issue perfectly",
];

const NEGATIVE_COMMENTS = [
  "Nie rozumiał mojego pytania",
  "Za długo czekałam na odpowiedź",
  "Podał złe informacje o rozmiarze",
  "Nie pomógł mi z reklamacją",
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

const CONNECTOR_SLUG = "estyl";

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
      price: { amount: p.pricePLN * 100, currency_code: "PLN" },
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
    description: `${product.brand} ${product.name} — dostępne rozmiary: ${product.sizes.join(", ")}`,
    category: product.category,
    brand: product.brand,
    price: { amount: product.pricePLN * 100, currency_code: "PLN" },
    variants: product.sizes.map((size, i) => ({
      id: `var_${product.id}_${i}`,
      title: `${size} / ${pick(product.colors)}`,
      prices: [{ amount: product.pricePLN * 100, currency_code: "PLN" }],
      inventory_quantity: randInt(0, 50),
    })),
    images: [{ url: `https://cdn.estyl.pl/products/${product.id}_1.jpg` }],
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
    userMsg(`Cześć, czy macie ${p.name} w kolorze ${color}, rozmiar ${size}?`),
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
      `Tak, mamy ${p.name} marki ${p.brand} w rozmiarze ${size}. Cena to ${p.pricePLN} PLN. Kolor ${color} jest dostępny. Czy chciałaby Pani dodać do koszyka?`,
    ),
  );
  if (rand() > 0.5) {
    msgs.push(userMsg("Dziękuję za informację, muszę jeszcze pomyśleć."));
    msgs.push(
      assistantMsg(
        "Oczywiście! Jeśli będzie Pani miała pytania, proszę śmiało pisać. Miłego dnia!",
      ),
    );
  }
  return msgs;
}

function genBrowseAndPurchase(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const size = pick(p.sizes);
  const color = pick(p.colors);
  const firstName = pick(POLISH_FIRST_NAMES);
  const lastName = pick(POLISH_LAST_NAMES);
  const city = pick(CITIES);
  const cityIdx = CITIES.indexOf(city);
  const postalCode = POSTAL_CODES[cityIdx] || "00-001";
  const street = pick(STREETS);
  const cartId = `cart_${uuid().slice(0, 8)}`;
  const variantId = `var_${p.id}_${randInt(0, p.sizes.length - 1)}`;
  const orderId = `order_${uuid().slice(0, 8)}`;

  const msgs: GeneratedMessage[] = [];
  msgs.push(
    userMsg(
      `Szukam ${p.category} na prezent. Coś eleganckiego do ${p.pricePLN < 300 ? "300" : "600"} PLN.`,
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
      `Polecam ${p.name} od ${p.brand} za ${p.pricePLN} PLN. Dostępne kolory: ${p.colors.join(", ")}. Chce Pani zobaczyć szczegóły?`,
    ),
  );
  msgs.push(userMsg(`Tak, poproszę ${color} w rozmiarze ${size}.`));
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
      { regionId: "reg_pl", currencyCode: "PLN" },
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
              unit_price: p.pricePLN * 100,
            },
          ],
          total: p.pricePLN * 100,
        },
      },
    ),
  );
  msgs.push(
    assistantMsg(
      `Dodałam ${p.name} (${size}, ${color}) do koszyka. Łączna kwota: ${p.pricePLN} PLN. Podać adres dostawy?`,
    ),
  );
  msgs.push(
    userMsg(
      `Tak, ${firstName} ${lastName}, ${street} ${randInt(1, 120)}, ${postalCode} ${city}`,
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
          address1: `${street} ${randInt(1, 120)}`,
          city,
          postalCode,
          countryCode: "PL",
        },
      },
      {
        cart: {
          id: cartId,
          shipping_address: { city, postal_code: postalCode },
        },
      },
    ),
  );
  msgs.push(assistantMsg("Adres zapisany. Potwierdzam zamówienie?"));
  msgs.push(userMsg("Tak, potwierdzam."));
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
      `Zamówienie zostało złożone! Numer zamówienia: ${orderId}. Potwierdzenie wysłane na maila. Dziękuję za zakupy w Estyl!`,
    ),
  );
  return msgs;
}

function genOrderStatus(): GeneratedMessage[] {
  const orderId = `order_${uuid().slice(0, 8)}`;
  const msgs: GeneratedMessage[] = [];
  msgs.push(userMsg(`Chciałbym sprawdzić status mojego zamówienia ${orderId}`));
  msgs.push(
    assistantMsg(
      "Niestety, nie mam bezpośredniego dostępu do systemu śledzenia przesyłek. Proszę sprawdzić status na stronie estyl.pl/moje-zamowienia lub podać numer śledzenia z maila z potwierdzeniem. Mogę pomóc w czymś innym?",
    ),
  );
  if (rand() > 0.4) {
    msgs.push(userMsg("A kiedy mogę spodziewać się dostawy?"));
    msgs.push(
      assistantMsg(
        "Standardowa dostawa to 2-4 dni robocze. Jeśli zamówienie było złożone ponad 5 dni temu i nie dotarło, proszę skontaktować się z naszym działem obsługi pod adresem pomoc@estyl.pl.",
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
      `Noszę rozmiar ${pick(["S", "M", "38", "40"])} w innych markach. Jaki rozmiar wybrać w ${p.name}?`,
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
      `${p.brand} ${p.name} ma standardowy krój. Przy wzroście 165-170 cm polecam rozmiar ${pick(p.sizes)}. Tabela rozmiarów dostępna na stronie produktu. Czy chce Pani dodać do koszyka?`,
    ),
  );
  if (rand() > 0.3) {
    msgs.push(userMsg("Dziękuję, wezmę ten rozmiar!"));
    msgs.push(
      assistantMsg("Świetny wybór! Czy mogę dodać produkt do koszyka?"),
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
      `Chciałabym zwrócić ${p.name} z zamówienia ${orderId}. Rozmiar jest za duży.`,
    ),
  );
  msgs.push(
    assistantMsg(
      "Rozumiem. Zwroty są możliwe w ciągu 30 dni od otrzymania przesyłki. Czy chce Pani wymianę na mniejszy rozmiar czy pełny zwrot?",
    ),
  );
  msgs.push(userMsg("Poproszę wymianę na rozmiar mniejszy."));
  msgs.push(
    assistantMsg(
      "Niestety wymiana wymaga kontaktu z naszym zespołem wsparcia. Przekazuję Pani sprawę do konsultanta, który pomoże z wymianą. Proszę chwilę poczekać.",
    ),
  );
  if (rand() > 0.5) {
    msgs.push(userMsg("Dobrze, czekam."));
  }
  return msgs;
}

function genDeliveryInquiry(): GeneratedMessage[] {
  const msgs: GeneratedMessage[] = [];
  const questions = [
    "Ile kosztuje dostawa do Niemiec?",
    "Czy mogę odebrać zamówienie w paczkomacie?",
    "Jak długo trwa dostawa kurierem?",
    "Czy jest darmowa dostawa od jakiejś kwoty?",
    "Czy wysyłacie za granicę?",
  ];
  msgs.push(userMsg(pick(questions)));
  msgs.push(
    assistantMsg(
      "Oferujemy kilka opcji dostawy:\n- Kurier DPD: 14.99 PLN (2-3 dni robocze)\n- Paczkomat InPost: 11.99 PLN (1-2 dni robocze)\n- Darmowa dostawa od 199 PLN\n- Wysyłka zagraniczna: od 39.99 PLN (EU)\n\nCzy mogę pomóc w czymś jeszcze?",
    ),
  );
  if (rand() > 0.6) {
    msgs.push(userMsg("Dziękuję, to wszystko!"));
    msgs.push(assistantMsg("Miłych zakupów! 😊"));
  }
  return msgs;
}

function genCartAbandonment(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const msgs: GeneratedMessage[] = [];
  msgs.push(userMsg(`Pokażcie mi ${p.category}`));
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
      `Oto nasze ${p.category}:\n${PRODUCTS.filter(
        (x) => x.category === p.category,
      )
        .slice(0, 3)
        .map((x) => `• ${x.name} — ${x.pricePLN} PLN`)
        .join("\n")}\n\nCzy chce Pani zobaczyć szczegóły któregoś produktu?`,
    ),
  );
  // User abandons — no more messages
  return msgs;
}

function genComplaint(): GeneratedMessage[] {
  const p = pick(PRODUCTS);
  const msgs: GeneratedMessage[] = [];
  const complaints = [
    `Otrzymałam uszkodzony produkt — ${p.name} ma plamę. To skandal!`,
    `Zamówiłam ${p.name} 2 tygodnie temu i nadal nie dotarło. Co się dzieje?`,
    `Dostałam zły kolor ${p.name}. Zamawiałam czarny a przyszedł szary!`,
    `Jakość ${p.name} jest bardzo niska jak na cenę ${p.pricePLN} PLN. Chcę zwrot!`,
  ];
  msgs.push(userMsg(pick(complaints)));
  msgs.push(
    assistantMsg(
      "Bardzo przepraszam za tę sytuację. Rozumiem Pani frustrację. Chcę jak najszybciej rozwiązać ten problem. Przekazuję sprawę do naszego specjalisty ds. reklamacji, który skontaktuje się w ciągu 24h.",
    ),
  );
  if (rand() > 0.4) {
    msgs.push(userMsg("Chcę rozmawiać z kierownikiem!"));
    msgs.push(
      assistantMsg(
        "Oczywiście, przekierowuję Panią do naszego managera zespołu obsługi. Proszę chwilę poczekać.",
      ),
    );
  }
  if (rand() > 0.6) {
    msgs.push(userMsg("Piszę też opinię na Google."));
  }
  return msgs;
}

function genMultiItemPurchase(): GeneratedMessage[] {
  const items = [pick(PRODUCTS), pick(PRODUCTS), pick(PRODUCTS)].filter(
    (p, i, a) => a.findIndex((x) => x.id === p.id) === i,
  );
  if (items.length < 2) items.push(PRODUCTS[0]);
  const firstName = pick(POLISH_FIRST_NAMES);
  const lastName = pick(POLISH_LAST_NAMES);
  const city = pick(CITIES);
  const cityIdx = CITIES.indexOf(city);
  const postalCode = POSTAL_CODES[cityIdx] || "00-001";
  const cartId = `cart_${uuid().slice(0, 8)}`;
  const orderId = `order_${uuid().slice(0, 8)}`;
  let total = 0;

  const msgs: GeneratedMessage[] = [];
  msgs.push(userMsg("Chciałabym kupić kilka rzeczy. Pomożecie?"));
  msgs.push(
    assistantMsg(
      "Oczywiście! Proszę powiedzieć, czego Pani szuka, a ja pomogę znaleźć idealne produkty.",
    ),
  );
  msgs.push(
    ...toolCallMsg(
      "Create Cart",
      { regionId: "reg_pl", currencyCode: "PLN" },
      { cart: { id: cartId } },
    ),
  );

  for (const item of items) {
    const size = pick(item.sizes);
    const variantId = `var_${item.id}_${randInt(0, item.sizes.length - 1)}`;
    total += item.pricePLN;

    msgs.push(userMsg(`Dodaj ${item.name} w rozmiarze ${size}`));
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
      assistantMsg(`Dodano ${item.name} (${size}). Suma: ${total} PLN.`),
    );
  }

  msgs.push(
    userMsg(
      `OK, chcę zamówić. Adres: ${firstName} ${lastName}, ${pick(STREETS)} ${randInt(1, 99)}, ${postalCode} ${city}`,
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
          address1: `${pick(STREETS)} ${randInt(1, 99)}`,
          city,
          postalCode,
          countryCode: "PL",
        },
      },
      { cart: { id: cartId, shipping_address: { city } } },
    ),
  );
  msgs.push(
    assistantMsg(
      `Adres dostawy ustawiony. Łączna kwota: ${total} PLN. Potwierdzić zamówienie?`,
    ),
  );
  msgs.push(userMsg("Tak, potwierdzam!"));
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
      `Zamówienie ${orderId} zostało złożone! Łączna kwota: ${total} PLN. Dziękuję za zakupy!`,
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

/** Hourly weight distribution for a Polish fashion store (CET) */
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
  return `+48 ${randInt(500, 899)} ${randInt(100, 999)} ${randInt(100, 999)}`;
}

// biome-ignore lint/suspicious/noMisleadingCharacterClass: standard NFD combining-marks strip pattern
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

function generateEmail(): string {
  const first = pick(POLISH_FIRST_NAMES)
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "");
  const last = pick(POLISH_LAST_NAMES)
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "");
  const domains = [
    "gmail.com",
    "wp.pl",
    "onet.pl",
    "o2.pl",
    "interia.pl",
    "outlook.com",
  ];
  return `${first}.${last}${randInt(1, 99)}@${pick(domains)}`;
}

function generateUserMetadata(): Record<string, unknown> {
  const firstName = pick(POLISH_FIRST_NAMES);
  const lastName = pick(POLISH_LAST_NAMES);
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

async function setupEstylOrg(db: SeedDb) {
  console.log("Setting up Estyl organization...\n");

  // 1. Create org
  const [orgRow] = await db
    .insert(organizations)
    .values({
      name: "Estyl",
      slug: "estyl",
      settings: {
        timezone: "Europe/Warsaw",
        features: ["voice-agents", "chat-agents"],
      },
    })
    .onConflictDoNothing()
    .returning();

  const org =
    orgRow ||
    (await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.slug, "estyl"),
    }));

  if (!org) throw new Error("Failed to create/find Estyl organization");
  console.log(`  Org: ${org.name} (${org.id})`);

  // 2. Create users
  const adminEmail = "delivered+admin-estyl@resend.dev";
  const supportEmail = "delivered+support-estyl@resend.dev";

  const [adminRow] = await db
    .insert(users)
    .values([
      {
        organizationId: org.id,
        email: adminEmail,
        name: "Estyl Admin",
        role: "admin",
        isActive: true,
      },
      {
        organizationId: org.id,
        email: supportEmail,
        name: "Estyl Support",
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
      name: "Estyl Store",
      slug: "estyl",
      config: {
        baseUrl: "https://api.estyl.pl",
        publishableKey: "pk_estyl_prod",
      },
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  const connector =
    connRow ||
    (await db.query.connectors.findFirst({
      where: (c, { eq, and }) =>
        and(eq(c.organizationId, org.id), eq(c.slug, "estyl")),
    }));
  if (!connector) throw new Error("Failed to create/find Estyl connector");
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
  const agentName = "Estyl Shopping Assistant";
  const [agentRow] = await db
    .insert(agents)
    .values({
      organizationId: org.id,
      name: agentName,
      description: "AI shopping assistant for estyl.pl fashion store",
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
      name: "Estyl Production Key",
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

    const { orgId, agentId } = await setupEstylOrg(db);
    await generateAndInsertSessions(db, orgId, agentId);

    console.log("\n=== Seed complete ===");
    console.log("Login as: delivered+admin-estyl@resend.dev");
  } finally {
    await queryClient.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
