import { z } from 'zod'

export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  agent_type: z.enum(['voice']),
  is_active: z.boolean(),
  key_prefix: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type Agent = z.infer<typeof agentSchema>

export const agentCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  agent_type: z.enum(['voice']),
})

export type AgentCreate = z.infer<typeof agentCreateSchema>

export const agentListResponseSchema = z.object({
  items: z.array(agentSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type AgentListResponse = z.infer<typeof agentListResponseSchema>
