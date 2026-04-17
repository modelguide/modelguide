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

import { createEvalConfig } from "@features/eval-configs/eval-configs.service";
import {
  createTestCase,
  createTestCaseEvaluator,
} from "@features/evals/eval-suites.service";
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
 * inside the async handler only after the first new case is accepted,
 * so existing cases survive if the pipeline fails without producing
 * replacements.
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

  // Old auto cases are deleted after the first new case is inserted,
  // so previously generated cases survive if the pipeline fails before
  // producing any replacements.
  let deletedOldCases = false;

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
    const MAX_ATTEMPTS = 2;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
          if (attempt < MAX_ATTEMPTS - 1) {
            log.debug(
              { tupleName, issues: structuralResult.issues },
              "structural validation failed — retrying",
            );
            continue;
          }
          rejected++;
          rejections.push({
            tupleName,
            issues: structuralResult.issues,
            rejectionSource: "structural",
          });
          break;
        }

        // Semantic validation
        const semanticResult = await validateSemantic(generated);
        validationTokens.input += semanticResult.usage.input;
        validationTokens.output += semanticResult.usage.output;

        if (!semanticResult.result.valid) {
          if (attempt < MAX_ATTEMPTS - 1) {
            log.debug(
              { tupleName, issues: semanticResult.result.issues },
              "semantic validation failed — retrying",
            );
            continue;
          }
          rejected++;
          rejections.push({
            tupleName,
            issues: semanticResult.result.issues,
            rejectionSource: "semantic",
          });
          break;
        }

        // Delete old auto cases on first accepted insert (avoids data loss
        // if the pipeline fails before producing any replacements)
        if (!deletedOldCases) {
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
          deletedOldCases = true;
        }

        // Insert test case + eval config + override atomically to prevent
        // orphan eval_configs on partial failure (PR review issue #2)
        const personaId = toneToPersonaId(tuple.tone);
        const testCase = await createTestCase(orgId, suiteId, {
          name: generated.name,
          description: generated.scenario,
          source: "auto",
          input: {
            message: generated.customer_message,
            persona: personaId,
          },
          mockToolResponses: generated.mock_tool_responses,
        });

        // Create a per-case LLM judge evaluator from the generated criterion
        const evalConfig = await createEvalConfig(orgId, {
          name: `Judge: ${generated.name}`,
          evaluatorType: "llm_judge",
          config: { criterion: generated.llm_judge_criterion },
          tags: ["auto-generated"],
        });
        await createTestCaseEvaluator(orgId, suiteId, testCase.id, {
          evalConfigId: evalConfig.id,
          overrideType: "add",
          required: true,
        });

        accepted++;
        break;
      } catch (err) {
        // Distinguish infrastructure errors (abort pipeline) from per-case failures (skip)
        if (isInfrastructureError(err)) {
          log.error(
            { err, tupleName, suiteId },
            "infrastructure error during generation — aborting pipeline",
          );
          throw err;
        }

        if (attempt < MAX_ATTEMPTS - 1) {
          log.debug(
            { err, tupleName },
            "test case generation failed — retrying",
          );
          continue;
        }

        // Per-case failure — skip and count as rejection
        log.warn(
          { err, tupleName, suiteId },
          "test case generation/validation failed — skipping after retry",
        );
        rejected++;
        rejections.push({
          tupleName,
          issues: [
            err instanceof Error ? err.message : "LLM generation failed",
          ],
          rejectionSource: "error",
        });
      }
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

  if (accepted === 0) {
    const topReason =
      result.topIssues[0]?.issue ?? "Unknown — check generation logs";
    updateProgress({
      status: "failed",
      completed: tuples.length,
      total: tuples.length,
      accepted: 0,
      rejected,
      error: `All ${rejected} test cases were rejected. Top issue: ${topReason}`,
      result,
    });
    log.warn(
      { suiteId, rejected, topIssues: result.topIssues },
      "test case generation produced 0 accepted cases",
    );
  } else {
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
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect infrastructure-level errors that should abort the entire pipeline
 * (auth failures, rate limits, network errors) vs per-case LLM failures
 * that can be safely skipped.
 *
 * Heuristic: checks structured status codes first (AI SDK errors carry
 * these), then falls back to message substring matching. May need updating
 * as LLM provider error formats evolve.
 */
/** @internal Exported for testing only. */
export function isInfrastructureError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check structured status code if available (AI SDK errors carry these)
  const status = (err as unknown as Record<string, unknown>).status;
  if (
    typeof status === "number" &&
    (status === 401 || status === 403 || status === 429)
  ) {
    return true;
  }

  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("authentication") ||
    msg.includes("unauthorized")
  );
}

function buildRunResult(
  accepted: number,
  rejected: number,
  rejections: GenerationRejection[],
  dimUsage: TokenUsage,
  genUsage: TokenUsage,
  valUsage: TokenUsage,
): GenerationRunResult {
  // Rejections by source
  const rejectionsBySource = { structural: 0, semantic: 0, error: 0 };
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
