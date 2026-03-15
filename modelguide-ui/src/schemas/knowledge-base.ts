import { z } from 'zod'

// --- Config schemas ---

export const guardrailCategorySchema = z.enum(['safety', 'compliance', 'brand', 'operational'])
export type GuardrailCategory = z.infer<typeof guardrailCategorySchema>

export const guardrailPrioritySchema = z.enum(['critical', 'high', 'medium', 'low'])
export type GuardrailPriority = z.infer<typeof guardrailPrioritySchema>

export const guardrailConfigSchema = z.object({
  category: guardrailCategorySchema.optional(),
  priority: guardrailPrioritySchema,
})
export type GuardrailConfig = z.infer<typeof guardrailConfigSchema>

// --- Knowledge Base types ---

export const knowledgeBaseTypeSchema = z.enum(['guardrail'])
export type KnowledgeBaseType = z.infer<typeof knowledgeBaseTypeSchema>

export interface AssignedAgent {
  id: string
  name: string
}

export interface KnowledgeBaseSummary {
  id: string
  type: KnowledgeBaseType
  name: string
  slug: string
  content: string
  description: string | null
  config: GuardrailConfig
  isActive: boolean
  assignedAgents: AssignedAgent[]
  createdAt: string
  updatedAt: string | null
}

export interface KnowledgeBaseDetail extends KnowledgeBaseSummary {
  createdBy: string | null
}

// --- Write operations ---

export interface KnowledgeBaseCreate {
  type: KnowledgeBaseType
  name: string
  slug?: string
  content: string
  description?: string
  config: GuardrailConfig
  isActive?: boolean
  agentIds?: string[]
}

export interface KnowledgeBaseUpdate {
  name?: string
  content?: string
  description?: string | null
  config?: GuardrailConfig
  isActive?: boolean
  agentIds?: string[]
}

// --- Display helpers ---

export const CATEGORY_LABELS: Record<GuardrailCategory, string> = {
  safety: 'Safety',
  compliance: 'Compliance',
  brand: 'Brand',
  operational: 'Operational',
}

export const PRIORITY_LABELS: Record<GuardrailPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const priorityVariantMap: Record<
  GuardrailPriority,
  'error' | 'warning' | 'default' | 'success'
> = {
  critical: 'error',
  high: 'warning',
  medium: 'default',
  low: 'success',
}

export const GUARDRAIL_CATEGORIES: GuardrailCategory[] = [
  'safety',
  'compliance',
  'brand',
  'operational',
]
export const GUARDRAIL_PRIORITIES: GuardrailPriority[] = ['critical', 'high', 'medium', 'low']
