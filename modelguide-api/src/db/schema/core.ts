/**
 * Core database table definitions
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  agentTypeEnum,
  channelTypeEnum,
  connectorTypeEnum,
  feedbackSourceEnum,
  messageRoleEnum,
  ownerTypeEnum,
  secretTypeEnum,
  sessionStatusEnum,
  userRoleEnum,
} from "./enums";

// ============================================================================
// Organizations
// ============================================================================

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  connectors: many(connectors),
  agents: many(agents),
  apiKeys: many(apiKeys),
  secrets: many(secrets),
  sessions: many(sessions),
}));

// ============================================================================
// Users
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull().default("support"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    uniqueIndex("users_org_email_unique").on(table.organizationId, table.email),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  createdAgents: many(agents),
  createdApiKeys: many(apiKeys),
  magicTokens: many(magicTokens),
}));

// ============================================================================
// Magic Tokens (for passwordless auth)
// ============================================================================

export const magicTokens = pgTable(
  "magic_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("magic_tokens_hash_unique").on(table.tokenHash),
    index("magic_tokens_user_idx").on(table.userId),
  ],
);

export const magicTokensRelations = relations(magicTokens, ({ one }) => ({
  user: one(users, {
    fields: [magicTokens.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Connectors Catalog (Global Registry)
// ============================================================================

export const connectorsCatalog = pgTable(
  "connectors_catalog",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    connectorType: connectorTypeEnum("connector_type").notNull(),
    configSchema: jsonb("config_schema")
      .$type<Record<string, unknown>>()
      .default({}),
    tools: jsonb("tools").$type<CatalogTool[]>().default([]),
    authMethods: text("auth_methods").array().default([]),
    iconUrl: varchar("icon_url", { length: 500 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("connectors_catalog_slug_unique").on(table.slug)],
);

export const connectorsCatalogRelations = relations(
  connectorsCatalog,
  ({ many }) => ({
    connectors: many(connectors),
  }),
);

/**
 * Tool template structure in connectors_catalog.tools JSONB
 */
export interface CatalogTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  defaultRequiresConfirmation: boolean;
  defaultTimeoutSeconds: number;
}

// ============================================================================
// Connectors (Org-specific instances)
// ============================================================================

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectorCatalogId: uuid("connector_catalog_id")
      .notNull()
      .references(() => connectorsCatalog.id),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    uniqueIndex("connectors_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    index("connectors_org_idx").on(table.organizationId),
  ],
);

export const connectorsRelations = relations(connectors, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [connectors.organizationId],
    references: [organizations.id],
  }),
  catalog: one(connectorsCatalog, {
    fields: [connectors.connectorCatalogId],
    references: [connectorsCatalog.id],
  }),
  tools: many(connectorTools),
}));

// ============================================================================
// Connector Tools
// ============================================================================

export const connectorTools = pgTable(
  "connector_tools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connectors.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    toolSchema: jsonb("tool_schema")
      .$type<Record<string, unknown>>()
      .default({}),
    connectionConfig: jsonb("connection_config")
      .$type<Record<string, unknown>>()
      .default({}),
    timeoutSeconds: integer("timeout_seconds").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    uniqueIndex("connector_tools_connector_slug_unique").on(
      table.connectorId,
      table.slug,
    ),
    index("connector_tools_org_idx").on(table.organizationId),
    index("connector_tools_connector_idx").on(table.connectorId),
  ],
);

export const connectorToolsRelations = relations(
  connectorTools,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [connectorTools.organizationId],
      references: [organizations.id],
    }),
    connector: one(connectors, {
      fields: [connectorTools.connectorId],
      references: [connectors.id],
    }),
    agentConnectorTools: many(agentConnectorTools),
  }),
);

// ============================================================================
// Secrets
// ============================================================================

export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    secretType: secretTypeEnum("secret_type").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    ownerType: ownerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index("secrets_org_idx").on(table.organizationId),
    index("secrets_owner_idx").on(table.ownerType, table.ownerId),
  ],
);

export const secretsRelations = relations(secrets, ({ one }) => ({
  organization: one(organizations, {
    fields: [secrets.organizationId],
    references: [organizations.id],
  }),
}));

// ============================================================================
// Agents
// ============================================================================

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    agentType: agentTypeEnum("agent_type").notNull().default("voice"),
    isActive: boolean("is_active").notNull().default(true),
    systemPrompt: text("system_prompt"),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index("agents_org_idx").on(table.organizationId),
    index("agents_active_idx").on(table.organizationId, table.isActive),
  ],
);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agents.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [agents.createdBy],
    references: [users.id],
  }),
  apiKeys: many(apiKeys),
  agentConnectorTools: many(agentConnectorTools),
  sessions: many(sessions),
}));

// ============================================================================
// API Keys
// ============================================================================

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_hash_unique").on(table.keyHash),
    index("api_keys_org_idx").on(table.organizationId),
    index("api_keys_agent_idx").on(table.agentId),
  ],
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  organization: one(organizations, {
    fields: [apiKeys.organizationId],
    references: [organizations.id],
  }),
  agent: one(agents, {
    fields: [apiKeys.agentId],
    references: [agents.id],
  }),
  creator: one(users, {
    fields: [apiKeys.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// Agent Connector Tools (Junction Table)
// ============================================================================

export const agentConnectorTools = pgTable(
  "agent_connector_tools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    connectorToolId: uuid("connector_tool_id")
      .notNull()
      .references(() => connectorTools.id, { onDelete: "cascade" }),
    isEnabled: boolean("is_enabled").notNull().default(true),
    requiresConfirmation: boolean("requires_confirmation")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_connector_tools_unique").on(
      table.agentId,
      table.connectorToolId,
    ),
    index("agent_connector_tools_agent_idx").on(table.agentId),
    index("agent_connector_tools_tool_idx").on(table.connectorToolId),
  ],
);

export const agentConnectorToolsRelations = relations(
  agentConnectorTools,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentConnectorTools.agentId],
      references: [agents.id],
    }),
    connectorTool: one(connectorTools, {
      fields: [agentConnectorTools.connectorToolId],
      references: [connectorTools.id],
    }),
  }),
);

// ============================================================================
// Sessions
// ============================================================================

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 255 }),
    channelType: channelTypeEnum("channel_type").notNull().default("voice"),
    userIdentifier: varchar("user_identifier", { length: 255 }),
    userMetadata: jsonb("user_metadata")
      .$type<Record<string, unknown>>()
      .default({}),
    status: sessionStatusEnum("status").notNull().default("active"),
    escalationRef: varchar("escalation_ref", { length: 255 }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index("sessions_org_idx").on(table.organizationId),
    index("sessions_agent_status_idx").on(table.agentId, table.status),
    index("sessions_started_at_idx").on(table.startedAt),
    index("sessions_external_id_idx").on(table.externalId),
  ],
);

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sessions.organizationId],
    references: [organizations.id],
  }),
  agent: one(agents, {
    fields: [sessions.agentId],
    references: [agents.id],
  }),
  messages: many(sessionMessages),
  feedback: many(sessionFeedback),
}));

// ============================================================================
// Session Messages
// ============================================================================

export const sessionMessages = pgTable(
  "session_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content"),
    audioUrl: varchar("audio_url", { length: 500 }),
    audioDurationMs: integer("audio_duration_ms"),
    toolCallId: varchar("tool_call_id", { length: 255 }),
    toolName: varchar("tool_name", { length: 255 }),
    toolInput: jsonb("tool_input").$type<Record<string, unknown>>(),
    toolOutput: jsonb("tool_output").$type<Record<string, unknown>>(),
    modelUsed: varchar("model_used", { length: 100 }),
    tokensUsed: integer("tokens_used"),
    latencyMs: integer("latency_ms"),
    sequenceNumber: integer("sequence_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("session_messages_session_idx").on(table.sessionId),
    index("session_messages_sequence_idx").on(
      table.sessionId,
      table.sequenceNumber,
    ),
  ],
);

export const sessionMessagesRelations = relations(
  sessionMessages,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionMessages.sessionId],
      references: [sessions.id],
    }),
  }),
);

// ============================================================================
// Session Feedback
// ============================================================================

export const sessionFeedback = pgTable(
  "session_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => sessionMessages.id, {
      onDelete: "set null",
    }),
    rating: integer("rating").notNull(), // 1 = negative, 2 = positive
    comment: text("comment"),
    feedbackSource: feedbackSourceEnum("feedback_source").notNull(),
    feedbackRef: varchar("feedback_ref", { length: 255 }),
    feedbackTags: text("feedback_tags").array().default([]),
    userIdentifier: varchar("user_identifier", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("session_feedback_session_idx").on(table.sessionId)],
);

export const sessionFeedbackRelations = relations(
  sessionFeedback,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionFeedback.sessionId],
      references: [sessions.id],
    }),
    message: one(sessionMessages, {
      fields: [sessionFeedback.messageId],
      references: [sessionMessages.id],
    }),
  }),
);
