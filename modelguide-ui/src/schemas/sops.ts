import { z } from 'zod'

// --- Trigger types (discriminated union on `type`) ---

const manualTriggerSchema = z.object({
  type: z.literal('manual'),
  config: z.object({}),
})

const channelTriggerSchema = z.object({
  type: z.literal('channel'),
  config: z.object({
    channelTypes: z.array(z.enum(['voice', 'chat', 'email'])).min(1),
  }),
})

const intentDetectedTriggerSchema = z.object({
  type: z.literal('intent_detected'),
  config: z.object({
    patterns: z.array(z.string()).min(1),
  }),
})

const toolPresentTriggerSchema = z.object({
  type: z.literal('tool_present'),
  config: z.object({
    toolSlugs: z.array(z.string()).min(1),
    catalogSlug: z.string().optional(),
  }),
})

export const sopTriggerSchema = z.discriminatedUnion('type', [
  manualTriggerSchema,
  channelTriggerSchema,
  intentDetectedTriggerSchema,
  toolPresentTriggerSchema,
])

export type SopTrigger = z.infer<typeof sopTriggerSchema>

// --- Step schema ---

export const sopStepSchema = z.object({
  id: z.string(),
  order: z.number(),
  instruction: z.string(),
  required: z.boolean(),
  tool: z
    .object({
      connectorToolId: z.string().uuid().optional(),
      connectorId: z.string().uuid().optional(),
      catalogSlug: z.string().optional(),
      toolSlug: z.string().optional(),
      resolvedName: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
})

export type SopStep = z.infer<typeof sopStepSchema>

// --- Metadata ---

export const sopMetadataSchema = z.object({
  reasonCode: z.string().optional(),
  tags: z.array(z.string()).optional(),
  estimatedDuration: z.string().optional(),
  escalationTriggers: z.array(z.string()).optional(),
})

export type SopMetadata = z.infer<typeof sopMetadataSchema>

// --- Definition ---

export const sopDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  trigger: sopTriggerSchema,
  steps: z.array(sopStepSchema),
  metadata: sopMetadataSchema,
})

export type SopDefinition = z.infer<typeof sopDefinitionSchema>

// --- Assigned agent ---

export const assignedAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  modality: z.enum(['voice', 'text']),
})

export type AssignedAgent = z.infer<typeof assignedAgentSchema>

// --- Step warning ---

export const stepWarningSchema = z.object({
  stepId: z.string(),
  message: z.string(),
})

export type StepWarning = z.infer<typeof stepWarningSchema>

// --- SOP Summary (list response) ---

export const sopSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
  version: z.string(),
  assignedAgents: z.array(assignedAgentSchema),
  sopTemplateId: z.string().uuid().nullable(),
  templateName: z.string().nullable(),
  stepCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export type SopSummary = z.infer<typeof sopSummarySchema>

// --- SOP Detail ---

export const sopDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'active', 'archived']),
  version: z.string(),
  assignedAgents: z.array(assignedAgentSchema),
  sopTemplateId: z.string().uuid().nullable(),
  template: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
    })
    .nullable(),
  definition: sopDefinitionSchema,
  stepWarnings: z.array(stepWarningSchema).optional(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export type SopDetail = z.infer<typeof sopDetailSchema>

// --- SOP Template ---

export const sopTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  catalogSlugs: z.array(z.string()),
  definition: sopDefinitionSchema,
  version: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export type SopTemplate = z.infer<typeof sopTemplateSchema>

// --- Write schemas ---

const sopStepCreateSchema = z.object({
  id: z.string().min(1).max(100),
  instruction: z.string().min(1).max(2000),
  required: z.boolean(),
  tool: z
    .object({
      connectorToolId: z.string().uuid(),
    })
    .optional(),
  notes: z.string().max(2000).optional(),
})

export const sopCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  description: z.string().max(2000).optional(),
  definition: z.object({
    schemaVersion: z.literal(1),
    trigger: sopTriggerSchema,
    steps: z.array(sopStepCreateSchema).max(100),
    metadata: sopMetadataSchema,
  }),
  agentIds: z.array(z.string().uuid()).optional(),
})

export type SopCreate = z.infer<typeof sopCreateSchema>

export const sopUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  definition: z
    .object({
      schemaVersion: z.literal(1),
      trigger: sopTriggerSchema,
      steps: z.array(sopStepCreateSchema).max(100),
      metadata: sopMetadataSchema,
    })
    .optional(),
  version: z.string().optional(),
})

export type SopUpdate = z.infer<typeof sopUpdateSchema>

export const forkFromTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  connectorMapping: z.record(z.string(), z.string().uuid()),
  agentIds: z.array(z.string().uuid()).optional(),
  overrides: z
    .object({
      trigger: sopTriggerSchema.optional(),
      metadata: sopMetadataSchema.optional(),
    })
    .optional(),
})

export type ForkFromTemplate = z.infer<typeof forkFromTemplateSchema>

// --- Trigger labels ---

export const TRIGGER_LABELS: Record<SopTrigger['type'], string> = {
  manual: 'Manual',
  channel: 'Channel',
  intent_detected: 'Intent Detected',
  tool_present: 'Tool Present',
}

// --- Status helpers ---

export type SopStatus = 'draft' | 'active' | 'archived'

export const statusVariantMap: Record<SopStatus, 'default' | 'success' | 'warning'> = {
  draft: 'default',
  active: 'success',
  archived: 'warning',
}
