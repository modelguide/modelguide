import { z } from 'zod'

import type { PaginatedResponse } from '~/lib/pagination'

export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  agentType: z.enum(['voice']),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Agent = z.infer<typeof agentSchema>

export const agentCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  agentType: z.enum(['voice']),
})

export type AgentCreate = z.infer<typeof agentCreateSchema>

export const agentWithKeySchema = agentSchema.extend({
  apiKey: z.string(),
})

export type AgentWithKey = z.infer<typeof agentWithKeySchema>

export const regenerateKeyResponseSchema = z.object({
  apiKey: z.string(),
  keyPrefix: z.string(),
})

export type RegenerateKeyResponse = z.infer<typeof regenerateKeyResponseSchema>

export type AgentListResponse = PaginatedResponse<Agent>

export interface AgentConnectorTool {
  id: string
  name: string
  slug: string
  isEnabled: boolean
  requiresConfirmation: boolean
}

export interface AgentConnector {
  connectorId: string
  connectorSlug: string
  connectorName: string
  tools: AgentConnectorTool[]
}
