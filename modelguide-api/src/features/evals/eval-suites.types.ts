/**
 * Service-level type contracts for eval suites.
 *
 * Separates input shapes, result shapes, and query result shapes
 * from the service implementation for reuse and clarity.
 */

import type { evalSuiteRuns } from "@db/schema";
import type { EvalRunScore, NewEvalRunScore } from "@db/schema";
import type { PaginationParams } from "@lib/pagination";
import type { InferSelectModel } from "drizzle-orm";

/** Row shape for eval_suite_runs table. */
type EvalSuiteRunRow = InferSelectModel<typeof evalSuiteRuns>;

// ============================================================================
// Input types
// ============================================================================

export interface InitEvalSuiteOpts {
  createdBy?: string;
}

export interface CreateSuiteInput {
  agentId: string;
  sopId?: string; // optional — for reference only, no derivation
  name: string;
}

export interface ListEvalSuitesParams extends PaginationParams {
  agentId?: string;
  sopId?: string;
}

export interface RunEvalSuiteOpts {
  triggeredBy?: string;
}

export interface CreateTestCaseInput {
  name: string;
  description?: string;
  category?: string;
  input?: Record<string, unknown>;
  expectedBehavior?: string;
}

export interface CreateAssertionInput {
  evalConfigId: string;
  name: string;
  required?: boolean;
}

// ============================================================================
// Result types (returned from mutation operations)
// ============================================================================

export interface TestCaseEvalResult {
  testCaseId: string;
  testCaseName: string;
  evalRunId: string | null;
  passed: boolean | null;
  scores: NewEvalRunScore[];
}

export interface SuiteRunResult {
  suiteRun: EvalSuiteRunRow & { completedAt: Date | null };
  results: TestCaseEvalResult[];
  durationMs: number;
}

// ============================================================================
// Query result types (returned from read operations)
// ============================================================================

export interface TestCaseRunDetail {
  testCaseId: string | null;
  evalRunId: string;
  passed: boolean | null;
  status: string;
  scores: EvalRunScore[];
}

export type SuiteRunDetail = EvalSuiteRunRow & {
  passed: boolean | null;
  testCaseResults: TestCaseRunDetail[];
};
