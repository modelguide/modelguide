import { z } from 'zod'

export const compileRequestSchema = z.object({
  sopId: z.string().uuid(),
  model: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
})

export type CompileRequest = z.infer<typeof compileRequestSchema>

const compilerWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  tokens: z.number().optional(),
})

export type CompilerWarning = z.infer<typeof compilerWarningSchema>

export const compileResponseSchema = z.object({
  agentId: z.string().uuid(),
  compiledAt: z.string(),
  compiledFrom: z.object({
    sopId: z.string().uuid(),
    sopName: z.string(),
    guardrailIds: z.array(z.string().uuid()),
    toolCount: z.number(),
    stepCount: z.number(),
  }),
  compiledPrompt: z.string(),
  promptLength: z.number(),
  toolCount: z.number(),
  metadata: z
    .object({
      systemPromptTokens: z.number(),
      estimatedToolSchemaTokens: z.number(),
      totalEstimatedTokens: z.number(),
      cacheablePrefix: z.number(),
      warnings: z.array(compilerWarningSchema),
    })
    .optional(),
})

export type CompileResponse = z.infer<typeof compileResponseSchema>
