import { z } from 'zod'

export const channelTypeSchema = z.enum([
  'voice',
  'web',
  'api',
  'slack',
  'widget',
  'sms',
  'whatsapp',
  'email',
])

export type ChannelType = z.infer<typeof channelTypeSchema>

export const sessionStatusSchema = z.enum(['active', 'completed', 'abandoned'])

export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().optional(),
  audioUrl: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.record(z.unknown()).optional(),
  toolOutput: z.record(z.unknown()).optional(),
  toolStatus: z.enum(['success', 'error']).nullable().optional(),
  latencyMs: z.number().optional(),
  audioDurationMs: z.number().optional(),
  modelUsed: z.string().optional(),
  tokensUsed: z.number().optional(),
  sequenceNumber: z.number().optional(),
  createdAt: z.string(),
})

export type SessionMessage = z.infer<typeof sessionMessageSchema>

export const sessionFeedbackSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  messageId: z.string().nullable(),
  rating: z.number().min(1).max(2),
  comment: z.string().nullable(),
  feedbackSource: z.enum(['customer', 'support', 'system']),
  feedbackRef: z.string().nullable(),
  feedbackTags: z.array(z.string()).nullable(),
  userIdentifier: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export type SessionFeedback = z.infer<typeof sessionFeedbackSchema>

// List endpoint item — no inline messages/feedback arrays
export const sessionListItemSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  agent: z.object({ id: z.string(), name: z.string() }),
  channelType: channelTypeSchema,
  status: sessionStatusSchema,
  userIdentifier: z.string(),
  userMetadata: z.record(z.unknown()).optional(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  metadata: z.record(z.unknown()).optional(),
  messageCount: z.number(),
  feedbackSummary: z.object({
    hasFeedback: z.boolean(),
    customerRating: z.number().nullable(),
    supportRating: z.number().nullable(),
  }),
})

export type SessionListItem = z.infer<typeof sessionListItemSchema>

export const sessionLinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  connectorSlug: z.string().nullable(),
  resourceType: z.string().nullable(),
  createdAt: z.string(),
})

export type SessionLink = z.infer<typeof sessionLinkSchema>

// Detail endpoint — includes messages + feedback + links
export const sessionDetailSchema = sessionListItemSchema.extend({
  messages: z.array(sessionMessageSchema),
  feedback: z.array(sessionFeedbackSchema),
  links: z.array(sessionLinkSchema).optional().default([]),
})

export type SessionDetail = z.infer<typeof sessionDetailSchema>
