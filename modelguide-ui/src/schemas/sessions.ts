import { z } from 'zod'

export const channelTypeSchema = z.enum([
  'voice',
  'web',
  'api',
  'slack',
  'widget',
  'sms',
  'whatsapp',
])

export type ChannelType = z.infer<typeof channelTypeSchema>

export const sessionStatusSchema = z.enum(['active', 'completed', 'escalated', 'abandoned'])

export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().optional(),
  audio_url: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.unknown()).optional(),
  tool_output: z.record(z.unknown()).optional(),
  status: z.enum(['success', 'error']).optional(),
  latency_ms: z.number().optional(),
  created_at: z.string(),
})

export type SessionMessage = z.infer<typeof sessionMessageSchema>

export const sessionFeedbackSchema = z.object({
  id: z.string(),
  rating: z.number().min(1).max(2),
  comment: z.string().nullable(),
  feedback_source: z.enum(['customer', 'support']),
  feedback_tags: z.array(z.string()).nullable(),
  created_at: z.string(),
})

export type SessionFeedback = z.infer<typeof sessionFeedbackSchema>

export const sessionSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  agent: z.object({
    id: z.string(),
    name: z.string(),
  }),
  channel_type: channelTypeSchema,
  status: sessionStatusSchema,
  user_identifier: z.string(),
  user_metadata: z.record(z.unknown()).optional(),
  escalation_ref: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  metadata: z.record(z.unknown()).optional(),
  messages: z.array(sessionMessageSchema).optional(),
  feedback: z.array(sessionFeedbackSchema).optional(),
})

export type Session = z.infer<typeof sessionSchema>

export const sessionListResponseSchema = z.object({
  items: z.array(sessionSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type SessionListResponse = z.infer<typeof sessionListResponseSchema>
