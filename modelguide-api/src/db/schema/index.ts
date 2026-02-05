/**
 * Database schema exports
 */

// Re-export all enums
export * from "./enums";

// Re-export all tables and relations
export * from "./core";

// Type exports for table inference
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  connectorsCatalog,
  magicTokens,
  organizations,
  secrets,
  sessionFeedback,
  sessionMessages,
  sessions,
  users,
} from "./core";

// Organization types
export type Organization = InferSelectModel<typeof organizations>;
export type NewOrganization = InferInsertModel<typeof organizations>;

// User types
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

// Magic token types
export type MagicToken = InferSelectModel<typeof magicTokens>;
export type NewMagicToken = InferInsertModel<typeof magicTokens>;

// Connectors catalog types
export type ConnectorCatalog = InferSelectModel<typeof connectorsCatalog>;
export type NewConnectorCatalog = InferInsertModel<typeof connectorsCatalog>;

// Connector types
export type Connector = InferSelectModel<typeof connectors>;
export type NewConnector = InferInsertModel<typeof connectors>;

// Connector tool types
export type ConnectorTool = InferSelectModel<typeof connectorTools>;
export type NewConnectorTool = InferInsertModel<typeof connectorTools>;

// Secret types
export type Secret = InferSelectModel<typeof secrets>;
export type NewSecret = InferInsertModel<typeof secrets>;

// Agent types
export type Agent = InferSelectModel<typeof agents>;
export type NewAgent = InferInsertModel<typeof agents>;

// API key types
export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

// Agent connector tool types
export type AgentConnectorTool = InferSelectModel<typeof agentConnectorTools>;
export type NewAgentConnectorTool = InferInsertModel<
  typeof agentConnectorTools
>;

// Session types
export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

// Session message types
export type SessionMessage = InferSelectModel<typeof sessionMessages>;
export type NewSessionMessage = InferInsertModel<typeof sessionMessages>;

// Session feedback types
export type SessionFeedback = InferSelectModel<typeof sessionFeedback>;
export type NewSessionFeedback = InferInsertModel<typeof sessionFeedback>;
