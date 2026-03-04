/**
 * Eval run API routes.
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
  createEvalRunSchema,
  evalRunListQuerySchema,
  evalRunResponseSchema,
  evalRunSummaryResponseSchema,
} from "./evals.schemas";

import { getEvalRunById, listEvalRuns, runEvaluation } from "./evals.service";

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
function formatRunDetail(r: ServiceRunDetail) {
  return {
    id: r.id,
    sessionId: r.sessionId,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    sourceName: r.sourceName ?? null,
    status: r.status as "pending" | "running" | "completed" | "failed",
    passed: r.passed,
    durationMs: r.durationMs,
    triggeredBy: r.triggeredBy,
    externalRunId: r.externalRunId,
    externalRunUrl: r.externalRunUrl,
    metadata: r.metadata as Record<string, unknown> | null,
    scores: r.scores.map((s) => ({
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
    })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

type ServiceRunSummary = Awaited<
  ReturnType<typeof listEvalRuns>
>["data"][number];
function formatRunSummary(r: ServiceRunSummary) {
  return {
    id: r.id,
    sessionId: r.sessionId,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    status: r.status as "pending" | "running" | "completed" | "failed",
    passed: r.passed,
    durationMs: r.durationMs,
    triggeredBy: r.triggeredBy,
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

// ============================================================================
// Middleware registration
// ============================================================================

router.post(
  "/runs",
  requireUser(),
  requirePermission("eval_runs:create"),
  requireOrganization(),
);
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

const createRunRoute = createRoute({
  method: "post",
  path: "/runs",
  tags: ["Evals"],
  summary: "Trigger evaluation",
  description:
    "Triggers an evaluation of a session against a source (SOP). Session must be in terminal status (completed or abandoned).",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createEvalRunSchema } },
    },
  },
  responses: {
    201: {
      description: "Eval run completed",
      content: {
        "application/json": { schema: evalRunResponseSchema },
      },
    },
    400: errorResponse("Session not in terminal status"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Session or SOP not found"),
    409: errorResponse("Eval already running"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createRunRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const triggeredBy = auth.type === "user" ? auth.user.id : undefined;

  const result = await runEvaluation(
    orgId,
    body.sessionId,
    body.sourceType,
    body.sourceId,
    { reporter: body.reporter, triggeredBy },
  );

  // Re-fetch for consistent response shape with sourceName
  const detail = await getEvalRunById(orgId, result.id);
  return c.json(formatRunDetail(detail), 201);
});

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
