/**
 * Test case generation pipeline — orchestrates dimension derivation,
 * tuple selection, LLM generation, validation, and DB insertion.
 *
 * Follows the async task runner pattern from simulate-and-run:
 * - enqueueGenerateTestCases() validates, enqueues, returns 202
 * - executeGenerateTestCases() is the async handler
 */

import { env } from "@/env";
import { forOrg } from "@db/rls";
import { evalSuiteTestCases, evalSuites } from "@db/schema";
import { getSopById } from "@features/sops/sops.service";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import { taskRunner } from "@lib/task-runner";
import { and, eq } from "drizzle-orm";

import { createTestCase } from "@features/evals/eval-suites.service";
import {
  deriveDimensionsFromSop,
  selectTuples,
  toneToPersonaId,
} from "./dimensions";
import { generateTestCase } from "./generate";
import { estimateModelCost } from "./model";
import type {
  GenerationCost,
  GenerationProgress,
  GenerationRejection,
  GenerationRunResult,
  TokenUsage,
  TopIssue,
} from "./types";
import { validateSemantic, validateStructural } from "./validate";

const log = getLogger();

// ============================================================================
// Payload type for the task runner
// ============================================================================

interface GenerateTestCasesPayload {
  orgId: string;
  suiteId: string;
  count: number;
}

// ============================================================================
// Public API — enqueue
// ============================================================================

/**
 * Validate suite has linked SOP and enqueue the generation task.
 * Returns immediately (HTTP 202 pattern). Old auto cases are deleted
 * inside the async handler to avoid data loss if the task fails early.
 */
export async function enqueueGenerateTestCases(
  orgId: string,
  suiteId: string,
  count = 40,
): Promise<{ taskId: string }> {
  // Guard: API key must be configured
  if (!env.GENERATION_LLM_API_KEY) {
    throw Errors.validationError(
      "GENERATION_LLM_API_KEY is not configured — cannot generate test cases",
    );
  }

  // Validate suite exists and has a linked SOP
  const suite = await forOrg(orgId, async (tx) => {
    const [s] = await tx
      .select({ id: evalSuites.id, sopId: evalSuites.sopId })
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));

    if (!s) throw Errors.evalSuiteNotFound(suiteId);
    return s;
  });

  if (!suite.sopId) {
    throw Errors.validationError(
      "Suite has no linked SOP \u2014 cannot derive dimensions",
    );
  }

  // Enqueue async generation (deletion happens inside the async handler)
  const taskId = taskRunner.enqueue<
    GenerateTestCasesPayload,
    GenerationProgress
  >("generate-test-cases", { orgId, suiteId, count }, executeGenerateTestCases);

  return { taskId };
}

/**
 * Get the current status of a generation task.
 */
export function getGenerationStatus(taskId: string) {
  return taskRunner.getStatus(taskId);
}

// ============================================================================
// Async task handler
// ============================================================================

async function executeGenerateTestCases(
  payload: GenerateTestCasesPayload,
  updateProgress: (progress: GenerationProgress) => void,
): Promise<void> {
  const { orgId, suiteId, count } = payload;

  // Initialize progress
  updateProgress({
    status: "deriving_dimensions",
    completed: 0,
    total: 0,
    accepted: 0,
    rejected: 0,
  });

  // 1. Load suite + SOP (re-validate inside async handler)
  const suite = await forOrg(orgId, async (tx) => {
    const [s] = await tx
      .select()
      .from(evalSuites)
      .where(eq(evalSuites.id, suiteId));
    if (!s) throw Errors.evalSuiteNotFound(suiteId);
    return s;
  });

  if (!suite.sopId) {
    throw Errors.validationError("Suite has no linked SOP");
  }

  const sopDetail = await getSopById(orgId, suite.sopId);

  // Delete old auto-generated cases (deferred into async handler
  // so old cases survive if the pipeline fails early)
  await forOrg(orgId, async (tx) => {
    await tx
      .delete(evalSuiteTestCases)
      .where(
        and(
          eq(evalSuiteTestCases.suiteId, suiteId),
          eq(evalSuiteTestCases.source, "auto"),
        ),
      );
  });

  // 2. Derive dimensions
  let dimensionResult: Awaited<ReturnType<typeof deriveDimensionsFromSop>>;
  try {
    dimensionResult = await deriveDimensionsFromSop(
      sopDetail.name,
      sopDetail.description,
      sopDetail.definition.steps,
    );
  } catch (err) {
    log.error({ err, suiteId }, "dimension derivation failed");
    updateProgress({
      status: "failed",
      completed: 0,
      total: 0,
      accepted: 0,
      rejected: 0,
      error: err instanceof Error ? err.message : "Dimension derivation failed",
    });
    throw err;
  }

  const { dimensions, usage: dimUsage } = dimensionResult;

  // 3. Select tuples
  const tuples = selectTuples(dimensions, { count });

  // 4. Generate + validate each tuple
  const rejections: GenerationRejection[] = [];
  let accepted = 0;
  let rejected = 0;
  const generationTokens: TokenUsage = { input: 0, output: 0 };
  const validationTokens: TokenUsage = { input: 0, output: 0 };

  updateProgress({
    status: "generating",
    completed: 0,
    total: tuples.length,
    accepted: 0,
    rejected: 0,
  });

  for (let i = 0; i < tuples.length; i++) {
    const tuple = tuples[i];
    const tupleName = `${tuple.intent} - ${tuple.tone} - ${tuple.edgeCase}`;

    try {
      // Generate test case
      const genResult = await generateTestCase(
        tuple,
        sopDetail.name,
        sopDetail.definition.steps,
      );
      generationTokens.input += genResult.usage.input;
      generationTokens.output += genResult.usage.output;

      const generated = genResult.testCase;

      // Structural validation
      const structuralResult = validateStructural(
        generated,
        sopDetail.definition.steps,
      );
      if (!structuralResult.valid) {
        rejected++;
        rejections.push({
          tupleName,
          issues: structuralResult.issues,
          rejectionSource: "structural",
        });
        updateProgress({
          status: "generating",
          completed: i + 1,
          total: tuples.length,
          accepted,
          rejected,
        });
        continue;
      }

      // Semantic validation
      const semanticResult = await validateSemantic(generated);
      validationTokens.input += semanticResult.usage.input;
      validationTokens.output += semanticResult.usage.output;

      if (!semanticResult.result.valid) {
        rejected++;
        rejections.push({
          tupleName,
          issues: semanticResult.result.issues,
          rejectionSource: "semantic",
        });
        updateProgress({
          status: "generating",
          completed: i + 1,
          total: tuples.length,
          accepted,
          rejected,
        });
        continue;
      }

      // Insert accepted test case
      const personaId = toneToPersonaId(tuple.tone);
      await createTestCase(orgId, suiteId, {
        name: generated.name,
        description: generated.scenario,
        source: "auto",
        input: {
          message: generated.input_email,
          persona: personaId,
        },
        mockToolResponses: generated.mock_tool_responses,
      });

      accepted++;
    } catch (err) {
      // Single case LLM failure -> skip + count as structural rejection
      log.warn(
        { err, tupleName, suiteId },
        "test case generation/validation failed — skipping",
      );
      rejected++;
      rejections.push({
        tupleName,
        issues: ["LLM generation failed"],
        rejectionSource: "structural",
      });
    }

    updateProgress({
      status: "generating",
      completed: i + 1,
      total: tuples.length,
      accepted,
      rejected,
    });
  }

  // 5. Build result
  const result = buildRunResult(
    accepted,
    rejected,
    rejections,
    dimUsage,
    generationTokens,
    validationTokens,
  );

  updateProgress({
    status: "completed",
    completed: tuples.length,
    total: tuples.length,
    accepted,
    rejected,
    result,
  });

  log.info(
    {
      suiteId,
      accepted,
      rejected,
      total: tuples.length,
      cost: result.cost.estimatedCostUsd,
    },
    "test case generation completed",
  );
}

// ============================================================================
// Helpers
// ============================================================================

function buildRunResult(
  accepted: number,
  rejected: number,
  rejections: GenerationRejection[],
  dimUsage: TokenUsage,
  genUsage: TokenUsage,
  valUsage: TokenUsage,
): GenerationRunResult {
  // Rejections by source
  const rejectionsBySource = { structural: 0, semantic: 0 };
  for (const r of rejections) {
    rejectionsBySource[r.rejectionSource]++;
  }

  // Top issues
  const issueCount = new Map<string, number>();
  for (const r of rejections) {
    for (const issue of r.issues) {
      issueCount.set(issue, (issueCount.get(issue) ?? 0) + 1);
    }
  }
  const topIssues: TopIssue[] = [...issueCount.entries()]
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Cost estimation using configured model pricing
  const dimCost = estimateModelCost(
    env.GENERATION_DIMENSION_MODEL,
    dimUsage.input,
    dimUsage.output,
  );
  const genCost = estimateModelCost(
    env.GENERATION_CASE_MODEL,
    genUsage.input,
    genUsage.output,
  );
  const valCost = estimateModelCost(
    env.GENERATION_CASE_MODEL,
    valUsage.input,
    valUsage.output,
  );
  const estimatedCostUsd =
    Math.round((dimCost + genCost + valCost) * 1000) / 1000;

  const cost: GenerationCost = {
    dimensionTokens: dimUsage,
    generationTokens: genUsage,
    validationTokens: valUsage,
    estimatedCostUsd,
  };

  return {
    accepted,
    rejected,
    rejections,
    rejectionsBySource,
    topIssues,
    cost,
  };
}
