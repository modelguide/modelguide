/**
 * Zod schemas for eval suite API validation.
 */

import { z } from "zod";

// ============================================================================
// Request schemas
// ============================================================================

export const initSuiteFromSopSchema = z.object({
  agentId: z.string().uuid(),
  sopId: z.string().uuid(),
});

export const createSuiteSchema = z.object({
  agentId: z.string().uuid(),
  sopId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
});

export const runEvalSuiteSchema = z.object({
  sessionId: z.string().uuid(),
  promptSource: z.enum(["compiled", "hand_written", "edited"]),
});

export const updateSuiteSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

export const updateTestCaseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

export const createTestCaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  expectedBehavior: z.string().optional(),
});

export const createEvaluatorSchema = z.object({
  evalConfigId: z.string().uuid(),
  name: z.string().min(1).max(255),
  required: z.boolean().optional(),
});

export const evalSuiteListQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  sopId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const evalSuiteRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const simulateAndRunSchema = z.object({
  promptSource: z.enum(["compiled", "hand_written", "edited"]),
  testCaseIds: z.array(z.string().uuid()).optional(),
  /** Optional override for per-suite test-case concurrency. Falls back to EVAL_CONCURRENCY env (default 5). */
  concurrency: z.coerce.number().int().min(1).max(20).optional(),
});

export const generateTestCasesSchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(40),
});

export const generateTestCasesResponseSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["running"]),
});

export const generationTaskStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  progress: z
    .object({
      status: z.enum([
        "deriving_dimensions",
        "generating",
        "completed",
        "failed",
      ]),
      completed: z.number(),
      total: z.number(),
      accepted: z.number(),
      rejected: z.number(),
      error: z.string().optional(),
      result: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  error: z.string().optional(),
});

export const simulateAndRunResponseSchema = z.object({
  suiteRunId: z.string().uuid(),
  status: z.enum(["running"]),
});

export const pinSessionAsTestCaseSchema = z.object({
  sessionId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

export const pinSessionAsTestCaseResponseSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.literal("recorded"),
  input: z.object({
    sessionId: z.string().uuid(),
    originalSessionId: z.string().uuid(),
  }),
  order: z.number(),
  createdAt: z.string(),
});

export const runTestCaseSchema = z.object({
  sessionId: z.string().uuid(),
  promptSource: z.enum(["compiled", "hand_written", "edited"]),
});

export const createTestCaseEvaluatorSchema = z.object({
  evalConfigId: z.string().uuid(),
  overrideType: z.enum(["add", "exclude"]),
  name: z.string().min(1).max(255).optional(),
  required: z.boolean().optional(),
});

// AC-26: update evalConfigId on a suite-level evaluator
export const updateSuiteEvaluatorSchema = z.object({
  evalConfigId: z.string().uuid(),
});

// AC-27: update evalConfigId on a test-case-level evaluator override
export const updateTestCaseEvaluatorSchema = z.object({
  evalConfigId: z.string().uuid(),
});

// ============================================================================
// Response schemas
// ============================================================================

const evalSuiteEvaluatorResponseSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  evalConfigId: z.string().uuid(),
  name: z.string(),
  sopStepId: z.string().nullable(),
  source: z.enum(["auto", "manual", "recorded"]),
  order: z.number(),
  required: z.boolean(),
  tags: z.array(z.string()),
  evaluatorType: z.string().nullable(),
  config: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

const evalTestCaseEvaluatorOverrideResponseSchema = z.object({
  id: z.string().uuid(),
  evalConfigId: z.string().uuid(),
  overrideType: z.enum(["add", "exclude"]),
  name: z.string(),
  order: z.number(),
  required: z.boolean(),
  source: z.enum(["auto", "manual", "recorded"]),
  evaluatorType: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
});

const evalSuiteTestCaseResponseSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.enum(["auto", "manual", "recorded"]),
  input: z.record(z.string(), z.unknown()).nullable(),
  expectedBehavior: z.string().nullable(),
  order: z.number(),
  evaluatorOverrides: z
    .array(evalTestCaseEvaluatorOverrideResponseSchema)
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const evalSuiteResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  sopId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  testCases: z.array(evalSuiteTestCaseResponseSchema).optional(),
  evaluators: z.array(evalSuiteEvaluatorResponseSchema).optional(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const evalSuiteSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string().nullable(),
  sopId: z.string().uuid().nullable(),
  sopName: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const testCaseResultSchema = z.object({
  testCaseId: z.string().uuid().nullable(),
  evalRunId: z.string().uuid(),
  passed: z.boolean().nullable(),
  status: z.string(),
  scores: z.array(
    z.object({
      id: z.string().uuid(),
      evalConfigId: z.string().uuid(),
      name: z.string(),
      scoreOrder: z.number(),
      required: z.boolean(),
      evaluatorType: z.string(),
      result: z.enum(["pass", "fail", "skip", "error"]),
      reasoning: z.string(),
      failureClassification: z.string().nullable(),
      expected: z.record(z.string(), z.unknown()).nullable(),
      actual: z.record(z.string(), z.unknown()).nullable(),
      durationMs: z.number().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const evalSuiteRunResponseSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  status: z.enum(["running", "completed", "completed_with_errors", "failed"]),
  promptSource: z.string(),
  passed: z.boolean().nullable(),
  triggeredBy: z.string().uuid().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  testCaseResults: z.array(testCaseResultSchema).optional(),
});
