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
  data?: Record<string, unknown>;
  error?: string;
  url?: string;
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

export interface HealthCheckResult {
  status: "healthy" | "error";
  latencyMs: number;
  message?: string;
  checkedAt: string; // ISO-8601
}

export interface ConnectorManifest {
  name: string;
  slug: string;
  description: string;
  connectorType: ConnectorType;
  configSchema: Record<string, ConfigFieldSchema>;
  authMethods: string[];
  iconUrl: string;
  tools: ConnectorToolDefinition[];
  healthCheck?: (config: Record<string, string>) => Promise<HealthCheckResult>;
}
