import { z } from 'zod'

// --- Assertion ---

export const evalSuiteAssertionSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  evalConfigId: z.string().uuid(),
  name: z.string(),
  sopStepId: z.string().nullable().optional(),
  source: z.enum(['auto', 'manual']),
  order: z.number(),
  required: z.boolean(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
})

export type EvalSuiteAssertion = z.infer<typeof evalSuiteAssertionSchema>

// --- Test Case ---

export const evalSuiteTestCaseSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  source: z.enum(['auto', 'manual']),
  input: z.record(z.unknown()).nullable().optional(),
  expectedBehavior: z.string().nullable().optional(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string().nullable().optional(),
})

export type EvalSuiteTestCase = z.infer<typeof evalSuiteTestCaseSchema>

// --- Suite Summary (list view) ---

export const evalSuiteSummarySchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string().nullable().optional(),
  sopId: z.string().uuid().nullable().optional(),
  sopName: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable().optional(),
})

export type EvalSuiteSummary = z.infer<typeof evalSuiteSummarySchema>

// --- Suite Detail (includes test cases) ---

export const evalSuiteDetailSchema = evalSuiteSummarySchema.extend({
  testCases: z.array(evalSuiteTestCaseSchema).optional(),
  evaluators: z.array(evalSuiteAssertionSchema).optional(),
})

export type EvalSuiteDetail = z.infer<typeof evalSuiteDetailSchema>

// --- Run Score ---

export const evalRunScoreSchema = z.object({
  id: z.string().uuid(),
  evalConfigId: z.string().uuid(),
  name: z.string(),
  scoreOrder: z.number(),
  required: z.boolean(),
  evaluatorType: z.string(),
  result: z.enum(['pass', 'fail', 'skip', 'error']),
  reasoning: z.string().nullable().optional(),
  failureClassification: z.string().nullable().optional(),
  expected: z.record(z.unknown()).nullable().optional(),
  actual: z.record(z.unknown()).nullable().optional(),
  durationMs: z.number().nullable().optional(),
  createdAt: z.string(),
})

export type EvalRunScore = z.infer<typeof evalRunScoreSchema>

// --- Test Case Result ---

export const testCaseResultSchema = z.object({
  testCaseId: z.string().uuid().nullable().optional(),
  testCaseName: z.string().nullable().optional(),
  evalRunId: z.string().uuid(),
  sessionId: z.string().uuid(),
  passed: z.boolean().nullable().optional(),
  status: z.string(),
  scores: z.array(evalRunScoreSchema),
})

export type TestCaseResult = z.infer<typeof testCaseResultSchema>

// --- Suite Run ---

export const evalSuiteRunSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  promptSource: z.enum(['compiled', 'hand_written', 'edited']),
  passed: z.boolean().nullable().optional(),
  triggeredBy: z.string().uuid().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  testCaseResults: z.array(testCaseResultSchema).optional().default([]),
})

export type EvalSuiteRun = z.infer<typeof evalSuiteRunSchema>

// --- Request types ---

export const initSuiteRequestSchema = z.object({
  agentId: z.string().uuid(),
  sopId: z.string().uuid(),
})

export type InitSuiteRequest = z.infer<typeof initSuiteRequestSchema>

export const runSuiteRequestSchema = z.object({
  sessionId: z.string().uuid(),
  promptSource: z.enum(['compiled', 'hand_written', 'edited']),
})

export type RunSuiteRequest = z.infer<typeof runSuiteRequestSchema>

// --- Prompt source labels ---

export const PROMPT_SOURCE_LABELS: Record<string, string> = {
  compiled: 'Compiled',
  hand_written: 'Hand Written',
  edited: 'Edited',
}
