/**
 * Eval run API routes — read-only queries for evaluation runs.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getOrganizationId,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { paginatedResponseSchema } from "@lib/pagination";
import { errorResponse } from "@lib/schemas";

import {
  evalRunListQuerySchema,
  evalRunResponseSchema,
  evalRunSummaryResponseSchema,
} from "./evals.schemas";

import { getEvalRunById, listEvalRuns } from "./evals.service";

const router = createRouter();

// ============================================================================
// Param schemas
// ============================================================================

const runIdParams = z.object({
  runId: z.string().uuid().openapi({ description: "Eval Run ID" }),
});

// ============================================================================
// Helpers
// ============================================================================

type ServiceRunDetail = Awaited<ReturnType<typeof getEvalRunById>>;
type ServiceRunSummary = Awaited<
  ReturnType<typeof listEvalRuns>
>["data"][number];

type RunStatus = "pending" | "running" | "completed" | "failed";

function formatRunCore(
  r: Pick<
    ServiceRunDetail,
    | "id"
    | "sessionId"
    | "sourceType"
    | "sourceId"
    | "status"
    | "passed"
    | "durationMs"
    | "triggeredBy"
    | "metadata"
    | "createdAt"
    | "updatedAt"
    | "completedAt"
  >,
) {
  return {
    id: r.id,
    sessionId: r.sessionId,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    status: r.status as RunStatus,
    passed: r.passed,
    durationMs: r.durationMs,
    triggeredBy: r.triggeredBy,
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

function formatScore(s: ServiceRunDetail["scores"][number]) {
  return {
    id: s.id,
    evalConfigId: s.evalConfigId,
    name: s.name,
    scoreOrder: s.scoreOrder,
    required: s.required,
    evaluatorType: s.evaluatorType,
    result: s.result as "pass" | "fail" | "skip" | "error",
    reasoning: s.reasoning,
    failureClassification: s.failureClassification,
    expected: s.expected as Record<string, unknown> | null,
    actual: s.actual as Record<string, unknown> | null,
    durationMs: s.durationMs,
    createdAt: s.createdAt.toISOString(),
  };
}

function formatRunDetail(r: ServiceRunDetail) {
  return {
    ...formatRunCore(r),
    sourceName: r.sourceName ?? null,
    externalRunId: r.externalRunId,
    externalRunUrl: r.externalRunUrl,
    scores: r.scores.map(formatScore),
  };
}

function formatRunSummary(r: ServiceRunSummary) {
  return formatRunCore(r);
}

// ============================================================================
// Middleware registration
// ============================================================================

router.get(
  "/runs",
  requireUser(),
  requirePermission("eval_runs:read"),
  requireOrganization(),
);
router.get(
  "/runs/:runId",
  requireUser(),
  requirePermission("eval_runs:read"),
  requireOrganization(),
);

// ============================================================================
// Routes
// ============================================================================

const listRunsRoute = createRoute({
  method: "get",
  path: "/runs",
  tags: ["Evals"],
  summary: "List eval runs",
  description: "Returns paginated list of eval runs.",
  security: [{ bearerAuth: [] }],
  request: { query: evalRunListQuerySchema },
  responses: {
    200: {
      description: "Paginated list of eval runs",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(evalRunSummaryResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listRunsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");
  const result = await listEvalRuns(orgId, query);
  return c.json(
    {
      data: result.data.map(formatRunSummary),
      pagination: result.pagination,
    },
    200,
  );
});

const getRunRoute = createRoute({
  method: "get",
  path: "/runs/{runId}",
  tags: ["Evals"],
  summary: "Get eval run",
  description: "Returns a single eval run with scores.",
  security: [{ bearerAuth: [] }],
  request: { params: runIdParams },
  responses: {
    200: {
      description: "Eval run detail with scores",
      content: {
        "application/json": { schema: evalRunResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Eval run not found"),
  },
});

router.openapi(getRunRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { runId } = c.req.valid("param");
  const detail = await getEvalRunById(orgId, runId);
  return c.json(formatRunDetail(detail), 200);
});

export default router;
