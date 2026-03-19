import { z } from 'zod'

export const compileRequestSchema = z.object({
  sopId: z.string().uuid(),
  model: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
})

export type CompileRequest = z.infer<typeof compileRequestSchema>

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
})

export type CompileResponse = z.infer<typeof compileResponseSchema>
