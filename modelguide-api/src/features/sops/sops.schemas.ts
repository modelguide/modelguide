/**
 * Zod schemas for SOP validation — definition JSONB, request/response shapes.
 */

import { z } from "zod";

// ============================================================================
// Trigger schemas (discriminated union)
// ============================================================================

const channelTriggerSchema = z.object({
  type: z.literal("channel"),
  config: z.object({
    channelTypes: z
      .array(z.enum(["voice", "chat", "email"]))
      .min(1, "At least one channel type is required"),
  }),
});

const intentDetectedTriggerSchema = z.object({
  type: z.literal("intent_detected"),
  config: z.object({
    patterns: z
      .array(z.string().max(500, "Pattern must be 500 characters or less"))
      .min(1, "At least one pattern is required"),
  }),
});

const toolPresentTriggerSchema = z.object({
  type: z.literal("tool_present"),
  config: z.object({
    toolSlugs: z.array(z.string()).min(1, "At least one tool slug is required"),
    catalogSlug: z.string().optional(),
  }),
});

const manualTriggerSchema = z.object({
  type: z.literal("manual"),
  config: z.object({}).strict(),
});

export const sopTriggerSchema = z.discriminatedUnion("type", [
  channelTriggerSchema,
  intentDetectedTriggerSchema,
  toolPresentTriggerSchema,
  manualTriggerSchema,
]);

// ============================================================================
// Step schema
// ============================================================================

const sopStepToolSchema = z.object({
  toolSlug: z.string().min(1, "Tool slug is required"),
  connectorId: z.string().uuid().optional(),
  catalogSlug: z.string().optional(),
  resolvedName: z.string().optional(),
});

export const sopStepSchema = z.object({
  id: z.string().min(1).max(100, "Step ID must be 100 characters or less"),
  order: z.number().int().min(1),
  instruction: z
    .string()
    .min(1, "Instruction is required")
    .max(2000, "Instruction must be 2000 characters or less"),
  required: z.boolean(),
  tool: sopStepToolSchema.optional(),
  notes: z.string().max(2000).optional(),
});

// ============================================================================
// Metadata schema
// ============================================================================

const sopMetadataSchema = z.object({
  reasonCode: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  estimatedDuration: z.string().max(100).optional(),
  escalationTriggers: z.array(z.string().max(500)).max(10).optional(),
});

// ============================================================================
// Top-level SOP definition schema
// ============================================================================

export const sopDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  trigger: sopTriggerSchema,
  steps: z.array(sopStepSchema).max(100, "Maximum 100 steps per SOP"),
  metadata: sopMetadataSchema,
});

// ============================================================================
// Request schemas
// ============================================================================

const slugPattern = /^[a-z0-9][a-z0-9_-]*$/;

export const createSopSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      slugPattern,
      "Slug must be lowercase alphanumeric with hyphens/underscores",
    )
    .optional(),
  description: z.string().max(2000).optional(),
  definition: sopDefinitionSchema,
  agentIds: z.array(z.string().uuid()).optional(),
});

export const forkFromTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).regex(slugPattern).optional(),
  connectorMapping: z.record(z.string(), z.string().uuid()),
  agentIds: z.array(z.string().uuid()).optional(),
  overrides: sopDefinitionSchema
    .pick({ trigger: true, metadata: true })
    .partial()
    .optional(),
});

export const updateSopSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    definition: sopDefinitionSchema.optional(),
    version: z.string().max(50).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.definition !== undefined ||
      data.version !== undefined,
    { message: "At least one field must be provided" },
  );

export const setAgentsSchema = z.object({
  agentIds: z.array(z.string().uuid()),
});

export const createVersionSchema = z.object({
  changeSummary: z.string().max(2000).optional(),
});

// ============================================================================
// Query schemas
// ============================================================================

export const sopListQuerySchema = z.object({
  status: z.enum(["draft", "active", "archived"]).optional(),
  agentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// Response schemas (for OpenAPI docs)
// ============================================================================

const assignedAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  modality: z.string(),
});

export const sopSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  version: z.string(),
  assignedAgents: z.array(assignedAgentSchema),
  templateId: z.string().uuid().nullable(),
  templateName: z.string().nullable().optional(),
  stepCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const stepWarningSchema = z.object({
  stepId: z.string(),
  message: z.string(),
});

export const sopDetailResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: z.enum(["draft", "active", "archived"]),
  version: z.string(),
  assignedAgents: z.array(assignedAgentSchema),
  templateId: z.string().uuid().nullable(),
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
});

export const sopTemplateResponseSchema = z.object({
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
});

export const sopVersionResponseSchema = z.object({
  id: z.string().uuid(),
  sopId: z.string().uuid(),
  version: z.string(),
  definition: sopDefinitionSchema,
  changeSummary: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
