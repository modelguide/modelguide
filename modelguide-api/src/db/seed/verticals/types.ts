/**
 * Shared types for industry-vertical seed configurations.
 * Each vertical (glowbox, clearhealth, steelpoint) implements OrgVerticalConfig
 * to drive the generic seedOrg() and generateSessions() functions.
 */

// ============================================================================
// Product & ticket templates
// ============================================================================

export interface Product {
  name: string;
  price: number;
  variants: string[];
  category: string;
}

export interface TicketTemplate {
  subject: string;
  priority: "urgent" | "high" | "normal" | "low";
  type: "problem" | "incident" | "question" | "task";
  tags: string[];
}

// ============================================================================
// Scenario & channel weights
// ============================================================================

export type Scenario =
  | "product_inquiry"
  | "purchase_flow"
  | "order_status"
  | "return_exchange"
  | "ticket_lookup"
  | "ticket_creation"
  | "ticket_escalation"
  | "general_question";

export type ChannelType =
  | "web"
  | "voice"
  | "widget"
  | "whatsapp"
  | "email"
  | "sms"
  | "slack"
  | "api";

export interface Weighted<T> {
  value: T;
  weight: number;
}

// ============================================================================
// Handwritten sessions
// ============================================================================

export interface HandwrittenMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HandwrittenFeedback {
  rating: 1 | 2;
  comment: string;
  source: "customer" | "support";
}

export interface HandwrittenLink {
  url: string;
  title: string;
  connectorSlug?: string;
  resourceType?: string;
}

export interface HandwrittenSession {
  /** Index into the agents array (0 = first agent, 1 = second) */
  agentIndex: number;
  channel: ChannelType;
  status: "active" | "completed" | "abandoned";
  userIdentifier: string;
  hoursAgo: number;
  messages: HandwrittenMessage[];
  feedback: HandwrittenFeedback | null;
  links: HandwrittenLink[];
}

// ============================================================================
// Feedback comment pools
// ============================================================================

export interface FeedbackPools {
  positiveCustomer: string[];
  negativeCustomer: string[];
  positiveSupport: string[];
  negativeSupport: string[];
}

// ============================================================================
// General Q&A for the "general_question" scenario
// ============================================================================

export interface GeneralQA {
  q: string;
  a: string;
}

// ============================================================================
// Main config
// ============================================================================

export interface OrgVerticalConfig {
  org: {
    name: string;
    slug: string;
    timezone: string;
    features: string[];
    demoEnabled?: boolean;
  };

  users: {
    admin: { email: string; name: string };
    support: { email: string; name: string };
    viewer: { email: string; name: string };
    inactive: { email: string; name: string };
  };

  /** Medusa e-commerce connector */
  ecommerce: {
    connectorName: string;
    connectorSlug: string;
    config: { baseUrl: string; publishableKey: string };
  };

  /** Zendesk helpdesk connector */
  helpdesk: {
    connectorName: string;
    connectorSlug: string;
    config: { subdomain: string; email: string };
  };

  agents: Array<{
    name: string;
    slug: string;
    description: string;
    /** Only "voice" is valid in the DB enum today; field exists for future types. */
    agentType?: "voice";
  }>;

  // Industry-specific data for session generation
  products: Product[];
  ticketTemplates: TicketTemplate[];
  generalQA: GeneralQA[];

  // ID prefixes for generated orders/tickets
  orderPrefix: string;
  ticketIdRange: [number, number];

  // URLs for session links
  baseUrl: string;
  helpdeskBaseUrl: string;

  // Weights
  scenarioWeights: Weighted<Scenario>[];
  channelWeights: Weighted<ChannelType>[];

  // Feedback
  feedback: FeedbackPools;

  // Handwritten showcase sessions
  handwrittenSessions: HandwrittenSession[];

  // Name pools for user identifiers (optional, falls back to defaults)
  firstNames?: string[];
  lastNames?: string[];
  emailDomains?: string[];
}
