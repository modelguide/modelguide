import { z } from 'zod'

// --- Catalog types ---

export const catalogToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  defaultRequiresConfirmation: z.boolean(),
  defaultTimeoutSeconds: z.number(),
})

export type CatalogTool = z.infer<typeof catalogToolSchema>

export const configFieldSchema = z.object({
  type: z.enum(['string', 'secret']),
  required: z.boolean(),
  description: z.string(),
})

export type ConfigField = z.infer<typeof configFieldSchema>

export const catalogEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  connectorType: z.enum(['api', 'webhook', 'database', 'messaging']),
  configSchema: z.record(z.string(), z.unknown()),
  tools: z.array(catalogToolSchema),
  authMethods: z.array(z.string()).nullable(),
  iconUrl: z.string().nullable(),
  isActive: z.boolean(),
  hasHealthCheck: z.boolean(),
  createdAt: z.string(),
})

export type CatalogEntry = z.infer<typeof catalogEntrySchema>

// --- Instance types ---

export const connectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  connectorCatalogId: z.string().uuid(),
  config: z.record(z.string(), z.unknown()),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export type Connector = z.infer<typeof connectorSchema>

export const connectorCreateSchema = z.object({
  connectorCatalogId: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  config: z.record(z.string(), z.unknown()).optional(),
})

export type ConnectorCreate = z.infer<typeof connectorCreateSchema>

export const connectorUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
})

export type ConnectorUpdate = z.infer<typeof connectorUpdateSchema>

// --- Tool types (per-instance) ---

export const connectorToolSchema = z.object({
  id: z.string().uuid(),
  connectorId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  toolSchema: z.record(z.string(), z.unknown()),
  timeoutSeconds: z.number(),
  isActive: z.boolean(),
  createdAt: z.string(),
})

export type ConnectorTool = z.infer<typeof connectorToolSchema>

export const connectorToolUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(300).optional(),
})

export type ConnectorToolUpdate = z.infer<typeof connectorToolUpdateSchema>

// --- Health check ---

export const healthCheckResultSchema = z.object({
  status: z.enum(['healthy', 'error']),
  latencyMs: z.number(),
  message: z.string().optional(),
  checkedAt: z.string(),
})

export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>

// --- Helpers ---

/**
 * Checks if all required config fields have values set in the connector's config.
 */
export function isConnectorConfigured(connector: Connector, catalogEntry: CatalogEntry): boolean {
  const schema = catalogEntry.configSchema as Record<string, ConfigField>
  for (const [key, field] of Object.entries(schema)) {
    if (field?.required) {
      const value = connector.config[key]
      if (value === undefined || value === null || value === '') {
        return false
      }
    }
  }
  return true
}
