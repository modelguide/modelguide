export * from "./enums";
export * from "./core";

import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  agentConnectorTools,
  agentSops,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  connectorsCatalog,
  magicTokens,
  organizations,
  secrets,
  securityTokens,
  sessionFeedback,
  sessionLinks,
  sessionMessages,
  sessions,
  sopSteps,
  sopTemplates,
  sopVersions,
  sops,
  users,
} from "./core";

export type Organization = InferSelectModel<typeof organizations>;
export type NewOrganization = InferInsertModel<typeof organizations>;

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type MagicToken = InferSelectModel<typeof magicTokens>;
export type NewMagicToken = InferInsertModel<typeof magicTokens>;

export type SecurityToken = InferSelectModel<typeof securityTokens>;
export type NewSecurityToken = InferInsertModel<typeof securityTokens>;

export type ConnectorCatalog = InferSelectModel<typeof connectorsCatalog>;
export type NewConnectorCatalog = InferInsertModel<typeof connectorsCatalog>;

export type Connector = InferSelectModel<typeof connectors>;
export type NewConnector = InferInsertModel<typeof connectors>;

export type ConnectorTool = InferSelectModel<typeof connectorTools>;
export type NewConnectorTool = InferInsertModel<typeof connectorTools>;

export type Secret = InferSelectModel<typeof secrets>;
export type NewSecret = InferInsertModel<typeof secrets>;

export type Agent = InferSelectModel<typeof agents>;
export type NewAgent = InferInsertModel<typeof agents>;

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type AgentConnectorTool = InferSelectModel<typeof agentConnectorTools>;
export type NewAgentConnectorTool = InferInsertModel<
  typeof agentConnectorTools
>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type SessionMessage = InferSelectModel<typeof sessionMessages>;
export type NewSessionMessage = InferInsertModel<typeof sessionMessages>;

export type SessionFeedback = InferSelectModel<typeof sessionFeedback>;
export type NewSessionFeedback = InferInsertModel<typeof sessionFeedback>;

export type SessionLink = InferSelectModel<typeof sessionLinks>;
export type NewSessionLink = InferInsertModel<typeof sessionLinks>;

export type SopTemplate = InferSelectModel<typeof sopTemplates>;
export type NewSopTemplate = InferInsertModel<typeof sopTemplates>;

export type Sop = InferSelectModel<typeof sops>;
export type NewSop = InferInsertModel<typeof sops>;

export type SopStepRow = InferSelectModel<typeof sopSteps>;
export type NewSopStepRow = InferInsertModel<typeof sopSteps>;

export type SopVersion = InferSelectModel<typeof sopVersions>;
export type NewSopVersion = InferInsertModel<typeof sopVersions>;

export type AgentSop = InferSelectModel<typeof agentSops>;
export type NewAgentSop = InferInsertModel<typeof agentSops>;
