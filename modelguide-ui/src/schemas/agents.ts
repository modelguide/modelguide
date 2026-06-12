import { z } from 'zod'

import type { PaginatedResponse } from '~/lib/pagination'

export const agentPlatforms = ['custom', 'elevenlabs', 'livekit'] as const
export type AgentPlatform = (typeof agentPlatforms)[number]

export const modelFamilies = ['gpt', 'claude', 'gemini', 'generic'] as const
export type ModelFamily = (typeof modelFamilies)[number]

export const promptConfigSchema = z.object({
  persona: z.string().optional(),
  language: z.string().optional(),
  fillerPhrases: z.array(z.string()).optional(),
})

export type PromptConfig = z.infer<typeof promptConfigSchema>

export const compiledFromSchema = z
  .object({
    sops: z.array(
      z.object({
        sopId: z.string().uuid(),
        sopName: z.string(),
        stepCount: z.number(),
      }),
    ),
    guardrailIds: z.array(z.string().uuid()),
    toolCount: z.number(),
  })
  .nullable()

export type CompiledFrom = z.infer<typeof compiledFromSchema>

export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  modality: z.enum(['voice', 'text']),
  modelFamily: z.enum(modelFamilies).optional().default('generic'),
  agentPlatform: z.enum(agentPlatforms),
  isActive: z.boolean(),
  evalSuiteCount: z.number().int().nonnegative().optional().default(0),
  promptConfig: promptConfigSchema.optional().default({}),
  metadata: z.record(z.unknown()).optional(),
  // Map of `fieldName -> secretId`, e.g. `{ livekit_api_key: "<uuid>" }`.
  // The API never returns decrypted values; this map is what the UI uses to
  // decide whether a secret is configured (without decrypting it). Optional
  // so fixtures and test doubles don't need to spell out an empty object.
  secrets: z.record(z.string()).optional(),
  hasElevenLabsKey: z.boolean(),
  hasWebhookSecret: z.boolean().optional(),
  keyPrefix: z.string().nullable().optional(),
  integrationUrls: z
    .object({
      sessionInit: z.string(),
      mcp: z.string(),
      postCallWebhook: z.string(),
      conversationInitWebhook: z.string(),
    })
    .optional(),
  compiledInstructions: z.string().nullable().optional(),
  compiledAt: z.string().nullable().optional(),
  compiledFrom: compiledFromSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Agent = z.infer<typeof agentSchema>

export const agentCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  modality: z.enum(['voice', 'text']),
  agentPlatform: z.enum(agentPlatforms).optional(),
  metadata: z.record(z.unknown()).optional(),
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

export interface SyncStep {
  step: string
  status: 'success' | 'skipped' | 'error'
  message?: string
}

export interface SyncResponse {
  secretId: string
  mcpServerId: string
  webhookId: string
  syncedAt: string
  steps: SyncStep[]
}

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
  connectorIconUrl: string | null
  tools: AgentConnectorTool[]
}

export interface OutboundCallResponse {
  sessionId: string
  roomName: string
  dispatchId: string
}

export const voiceTestTokenResponseSchema = z.object({
  livekitUrl: z.string(),
  roomName: z.string(),
  token: z.string(),
  sessionId: z.string().uuid(),
  dispatchId: z.string(),
  agentName: z.string(),
  profileName: z.string(),
  identity: z.string(),
})

export type VoiceTestTokenResponse = z.infer<typeof voiceTestTokenResponseSchema>

export const voicePrototypeTokenResponseSchema = z.object({
  livekitUrl: z.string(),
  roomName: z.string(),
  token: z.string(),
  sessionId: z.string().uuid(),
  dispatchId: z.string(),
  agentName: z.string(),
  identity: z.string(),
  promptChars: z.number().int().nonnegative(),
})

export type VoicePrototypeTokenResponse = z.infer<typeof voicePrototypeTokenResponseSchema>
