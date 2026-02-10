/**
 * Shared types for the connector module system.
 * Each connector is a TypeScript module with a manifest and executable tool handlers.
 */

import type { CatalogTool } from "@db/schema/core";

export interface ToolExecutionContext {
  config: Record<string, string>;
  input: Record<string, unknown>;
  organizationId: string;
  connectorId: string;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: { [key: string]: unknown };
  error?: string;
}

export interface ConnectorToolDefinition {
  catalog: CatalogTool;
  handler: (ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface ConfigFieldSchema {
  type: "string" | "secret" | "number" | "boolean";
  required: boolean;
  description: string;
  default?: string | number | boolean;
}

export type ConnectorType = "api" | "webhook" | "database" | "messaging";

export interface ConnectorManifest {
  name: string;
  slug: string;
  description: string;
  connectorType: ConnectorType;
  configSchema: Record<string, ConfigFieldSchema>;
  authMethods: string[];
  iconUrl: string;
  tools: ConnectorToolDefinition[];
}
