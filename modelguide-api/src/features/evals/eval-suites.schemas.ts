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

export const createTestCaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().max(100).optional(),
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

// ============================================================================
// Response schemas
// ============================================================================

const evalSuiteEvaluatorResponseSchema = z.object({
  id: z.string().uuid(),
  testCaseId: z.string().uuid(),
  evalConfigId: z.string().uuid(),
  name: z.string(),
  sopStepId: z.string().nullable(),
  source: z.enum(["auto", "manual"]),
  order: z.number(),
  required: z.boolean(),
  createdAt: z.string(),
});

const evalSuiteTestCaseResponseSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.enum(["auto", "manual"]),
  input: z.record(z.string(), z.unknown()).nullable(),
  expectedBehavior: z.string().nullable(),
  order: z.number(),
  evaluators: z.array(evalSuiteEvaluatorResponseSchema),
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
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export const evalSuiteSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  sopId: z.string().uuid().nullable(),
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
  promptSource: z.string(),
  passed: z.boolean().nullable(),
  triggeredBy: z.string().uuid().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  testCaseResults: z.array(testCaseResultSchema).optional(),
});
