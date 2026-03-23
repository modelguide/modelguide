/**
 * Zod schemas for eval run API validation.
 */

import { z } from "zod";

// ============================================================================
// Request schemas
// ============================================================================

export const evalRunListQuerySchema = z.object({
  sessionId: z.string().uuid().optional(),
  sourceType: z.enum(["suite", "replay_test", "live"]).optional(),
  sourceId: z.string().uuid().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// Response schemas
// ============================================================================

const evalScoreResponseSchema = z.object({
  id: z.string().uuid(),
  evalConfigId: z.string().uuid().nullable(),
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
});

export const evalRunResponseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  sourceType: z.string(),
  sourceId: z.string().uuid(),
  sourceName: z.string().nullable().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  passed: z.boolean().nullable(),
  durationMs: z.number().nullable(),
  triggeredBy: z.string().uuid().nullable(),
  externalRunId: z.string().nullable(),
  externalRunUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  scores: z.array(evalScoreResponseSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const evalRunSummaryResponseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  sourceType: z.string(),
  sourceId: z.string().uuid(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  passed: z.boolean().nullable(),
  durationMs: z.number().nullable(),
  triggeredBy: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
