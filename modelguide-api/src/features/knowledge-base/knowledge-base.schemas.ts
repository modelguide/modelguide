/**
 * Zod schemas for Knowledge Base request/response validation.
 */

import { z } from "zod";

// ============================================================================
// Shared sub-schemas
// ============================================================================

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

export const knowledgeBaseTypeSchema = z.enum(["guardrail"]);

const guardrailCategorySchema = z.enum([
  "safety",
  "compliance",
  "brand",
  "operational",
]);

const guardrailPrioritySchema = z.enum(["critical", "high", "medium", "low"]);

export const guardrailConfigSchema = z.object({
  category: guardrailCategorySchema.optional(),
  priority: guardrailPrioritySchema,
});

/** Config schema resolved by type. Currently only guardrails. */
export const knowledgeBaseConfigSchema = guardrailConfigSchema;

const assignedAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

// ============================================================================
// Request schemas
// ============================================================================

export const createKnowledgeBaseSchema = z.object({
  type: knowledgeBaseTypeSchema,
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(slugPattern, "Slug must be lowercase alphanumeric with hyphens")
    .optional(),
  content: z.string().min(1).max(5000),
  description: z.string().max(2000).optional(),
  config: knowledgeBaseConfigSchema,
  isActive: z.boolean().optional(),
  agentIds: z.array(z.string().uuid()).optional(),
});

export const updateKnowledgeBaseSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    content: z.string().min(1).max(5000).optional(),
    description: z.string().max(2000).nullable().optional(),
    config: knowledgeBaseConfigSchema.optional(),
    isActive: z.boolean().optional(),
    agentIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.content !== undefined ||
      data.description !== undefined ||
      data.config !== undefined ||
      data.isActive !== undefined ||
      data.agentIds !== undefined,
    { message: "At least one field must be provided" },
  );

export const knowledgeBaseListQuerySchema = z.object({
  type: knowledgeBaseTypeSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  agentId: z.string().uuid().optional(),
  category: guardrailCategorySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// Response schemas
// ============================================================================

export const knowledgeBaseSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  type: knowledgeBaseTypeSchema,
  name: z.string(),
  slug: z.string(),
  content: z.string(),
  description: z.string().nullable(),
  config: z.record(z.unknown()),
  isActive: z.boolean(),
  assignedAgents: z.array(assignedAgentSchema),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const knowledgeBaseDetailResponseSchema =
  knowledgeBaseSummaryResponseSchema.extend({
    createdBy: z.string().uuid().nullable(),
  });
