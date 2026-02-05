import { z } from 'zod'

export const connectorToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  default_requires_confirmation: z.boolean(),
})

export type ConnectorTool = z.infer<typeof connectorToolSchema>

export const connectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  connector_type: z.enum(['api', 'webhook', 'database', 'messaging']),
  icon_url: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  is_configured: z.boolean(),
  tools: z.array(connectorToolSchema),
  created_at: z.string(),
})

export type Connector = z.infer<typeof connectorSchema>

export const connectorListResponseSchema = z.object({
  items: z.array(connectorSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type ConnectorListResponse = z.infer<typeof connectorListResponseSchema>
