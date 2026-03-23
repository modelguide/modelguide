/**
 * Eval suite API routes.
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
  createEvaluatorSchema,
  createSuiteSchema,
  createTestCaseSchema,
  evalSuiteListQuerySchema,
  evalSuiteResponseSchema,
  evalSuiteRunResponseSchema,
  evalSuiteRunsQuerySchema,
  evalSuiteSummaryResponseSchema,
  initSuiteFromSopSchema,
  runEvalSuiteSchema,
} from "./eval-suites.schemas";
import {
  createEvaluator,
  createSuite,
  createTestCase,
  deleteEvalSuite,
  getEvalSuiteById,
  getEvalSuiteRunById,
  getEvalSuiteRuns,
  initSuiteFromSop,
  listEvalSuites,
  runEvalSuite,
} from "./eval-suites.service";

const router = createRouter();

// ============================================================================
// Param schemas
// ============================================================================

const suiteIdParams = z.object({
  suiteId: z.string().uuid().openapi({ description: "Eval Suite ID" }),
});

const runIdParams = z.object({
  suiteId: z.string().uuid().openapi({ description: "Eval Suite ID" }),
  runId: z.string().uuid().openapi({ description: "Eval Suite Run ID" }),
});

const testCaseParams = z.object({
  suiteId: z.string().uuid().openapi({ description: "Eval Suite ID" }),
  testCaseId: z.string().uuid().openapi({ description: "Test Case ID" }),
});

// ============================================================================
// Formatters
// ============================================================================

type SuiteDetail = Awaited<ReturnType<typeof getEvalSuiteById>>;
type SuiteRunDetail = Awaited<ReturnType<typeof getEvalSuiteRunById>>;

function formatEvaluator(
  a: SuiteDetail["testCases"][number]["evaluators"][number],
) {
  return {
    id: a.id,
    testCaseId: a.testCaseId,
    evalConfigId: a.evalConfigId,
    name: a.name,
    sopStepId: a.sopStepId,
    source: a.source,
    order: a.order,
    required: a.required,
    createdAt: a.createdAt.toISOString(),
  };
}

function formatTestCase(tc: SuiteDetail["testCases"][number]) {
  return {
    id: tc.id,
    suiteId: tc.suiteId,
    name: tc.name,
    description: tc.description,
    source: tc.source,
    input: tc.input as Record<string, unknown> | null,
    expectedBehavior: tc.expectedBehavior,
    order: tc.order,
    evaluators: tc.evaluators.map(formatEvaluator),
    createdAt: tc.createdAt.toISOString(),
    updatedAt: tc.updatedAt?.toISOString() ?? null,
  };
}

function formatSuiteDetail(s: SuiteDetail) {
  return {
    id: s.id,
    agentId: s.agentId,
    sopId: s.sopId,
    name: s.name,
    description: s.description,
    testCases: s.testCases.map(formatTestCase),
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

function formatSuiteSummary(s: {
  id: string;
  agentId: string;
  agentName?: string | null;
  sopId: string | null;
  sopName?: string | null;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  return {
    id: s.id,
    agentId: s.agentId,
    agentName: s.agentName ?? null,
    sopId: s.sopId,
    sopName: s.sopName ?? null,
    name: s.name,
    description: s.description,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

function formatScore(
  s: SuiteRunDetail["testCaseResults"][number]["scores"][number],
) {
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

function formatSuiteRun(r: SuiteRunDetail) {
  return {
    id: r.id,
    suiteId: r.suiteId,
    sessionId: r.sessionId ?? null,
    promptSource: r.promptSource,
    passed: r.passed,
    triggeredBy: r.triggeredBy,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    durationMs: r.durationMs ?? null,
    metadata: r.metadata as Record<string, unknown> | null,
    testCaseResults: r.testCaseResults.map((tc) => ({
      testCaseId: tc.testCaseId,
      testCaseName: tc.testCaseName ?? null,
      evalRunId: tc.evalRunId,
      passed: tc.passed,
      status: tc.status,
      scores: tc.scores.map(formatScore),
    })),
  };
}

function formatSuiteRunSummary(
  r: Awaited<ReturnType<typeof getEvalSuiteRuns>>["data"][number],
) {
  return {
    id: r.id,
    suiteId: r.suiteId,
    sessionId: r.sessionId ?? null,
    promptSource: r.promptSource,
    passed: r.passed,
    triggeredBy: r.triggeredBy,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    durationMs: r.durationMs ?? null,
    metadata: r.metadata as Record<string, unknown> | null,
    testCaseResults: r.testCaseResults.map((tc) => ({
      testCaseId: tc.testCaseId,
      testCaseName: tc.testCaseName ?? null,
      evalRunId: tc.evalRunId,
      passed: tc.passed,
      status: tc.status,
      scores: tc.scores.map(formatScore),
    })),
  };
}

// ============================================================================
// Middleware registration
// ============================================================================

router.post(
  "/init",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.get(
  "/",
  requireUser(),
  requirePermission("eval_suites:read"),
  requireOrganization(),
);
router.get(
  "/:suiteId",
  requireUser(),
  requirePermission("eval_suites:read"),
  requireOrganization(),
);
router.delete(
  "/:suiteId",
  requireUser(),
  requirePermission("eval_suites:delete"),
  requireOrganization(),
);
router.post(
  "/:suiteId/run",
  requireUser(),
  requirePermission("eval_suites:run"),
  requireOrganization(),
);
router.get(
  "/:suiteId/runs",
  requireUser(),
  requirePermission("eval_suites:read"),
  requireOrganization(),
);
router.get(
  "/:suiteId/runs/:runId",
  requireUser(),
  requirePermission("eval_suites:read"),
  requireOrganization(),
);
router.post(
  "/:suiteId/test-cases",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.post(
  "/:suiteId/test-cases/:testCaseId/evaluators",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);

// ============================================================================
// Routes
// ============================================================================

// POST /init — init (or re-init) suite from SOP
const initSuiteRoute = createRoute({
  method: "post",
  path: "/init",
  tags: ["Eval Suites"],
  summary: "Initialize eval suite from SOP",
  description:
    "Creates or re-initializes an eval suite for an agent+SOP pair. Derives test cases from SOP steps and guardrails.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: initSuiteFromSopSchema } },
    },
  },
  responses: {
    201: {
      description: "Eval suite initialized",
      content: {
        "application/json": { schema: evalSuiteResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent or SOP not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(initSuiteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;

  const result = await initSuiteFromSop(orgId, body.agentId, body.sopId, {
    createdBy,
  });

  return c.json(formatSuiteDetail(result), 201);
});

// POST / — create empty suite (manual)
const createSuiteRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Eval Suites"],
  summary: "Create eval suite",
  description:
    "Creates an empty eval suite. User adds test cases and evaluators via CRUD endpoints.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createSuiteSchema } },
    },
  },
  responses: {
    201: {
      description: "Eval suite created",
      content: {
        "application/json": { schema: evalSuiteSummaryResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createSuiteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;

  const suite = await createSuite(orgId, body, { createdBy });

  return c.json(formatSuiteSummary(suite), 201);
});

// GET / — list suites
const listSuitesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Eval Suites"],
  summary: "List eval suites",
  description: "Returns paginated list of eval suites.",
  security: [{ bearerAuth: [] }],
  request: { query: evalSuiteListQuerySchema },
  responses: {
    200: {
      description: "Paginated list of eval suites",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(evalSuiteSummaryResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listSuitesRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");
  const result = await listEvalSuites(orgId, query);
  return c.json(
    {
      data: result.data.map(formatSuiteSummary),
      pagination: result.pagination,
    },
    200,
  );
});

// GET /:suiteId — get suite detail
const getSuiteRoute = createRoute({
  method: "get",
  path: "/{suiteId}",
  tags: ["Eval Suites"],
  summary: "Get eval suite",
  description: "Returns a single eval suite with test cases and evaluators.",
  security: [{ bearerAuth: [] }],
  request: { params: suiteIdParams },
  responses: {
    200: {
      description: "Eval suite detail",
      content: {
        "application/json": { schema: evalSuiteResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Eval suite not found"),
  },
});

router.openapi(getSuiteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const detail = await getEvalSuiteById(orgId, suiteId);
  return c.json(formatSuiteDetail(detail), 200);
});

// DELETE /:suiteId
const deleteSuiteRoute = createRoute({
  method: "delete",
  path: "/{suiteId}",
  tags: ["Eval Suites"],
  summary: "Delete eval suite",
  description: "Deletes an eval suite and all its test cases and evaluators.",
  security: [{ bearerAuth: [] }],
  request: { params: suiteIdParams },
  responses: {
    204: { description: "Eval suite deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval suite not found"),
  },
});

router.openapi(deleteSuiteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  await deleteEvalSuite(orgId, suiteId);
  return c.body(null, 204);
});

// POST /:suiteId/run — run suite
const runSuiteRoute = createRoute({
  method: "post",
  path: "/{suiteId}/run",
  tags: ["Eval Suites"],
  summary: "Run eval suite",
  description:
    "Executes all test cases in a suite against session transcripts.",
  security: [{ bearerAuth: [] }],
  request: {
    params: suiteIdParams,
    body: {
      content: { "application/json": { schema: runEvalSuiteSchema } },
    },
  },
  responses: {
    201: {
      description: "Suite run completed",
      content: {
        "application/json": { schema: evalSuiteRunResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval suite not found"),
  },
});

router.openapi(runSuiteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const triggeredBy = auth.type === "user" ? auth.user.id : undefined;

  const result = await runEvalSuite(
    orgId,
    suiteId,
    body.sessionId,
    body.promptSource,
    { triggeredBy },
  );

  const detail = await getEvalSuiteRunById(orgId, suiteId, result.suiteRun.id);
  return c.json(formatSuiteRun(detail), 201);
});

// GET /:suiteId/runs — list runs
const listRunsRoute = createRoute({
  method: "get",
  path: "/{suiteId}/runs",
  tags: ["Eval Suites"],
  summary: "List suite runs",
  description:
    "Returns paginated list of suite runs with per-test-case breakdown.",
  security: [{ bearerAuth: [] }],
  request: {
    params: suiteIdParams,
    query: evalSuiteRunsQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated list of suite runs",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(evalSuiteRunResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Eval suite not found"),
  },
});

router.openapi(listRunsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const query = c.req.valid("query");
  const result = await getEvalSuiteRuns(orgId, suiteId, query);
  return c.json(
    {
      data: result.data.map(formatSuiteRunSummary),
      pagination: result.pagination,
    },
    200,
  );
});

// GET /:suiteId/runs/:runId — get run detail
const getRunRoute = createRoute({
  method: "get",
  path: "/{suiteId}/runs/{runId}",
  tags: ["Eval Suites"],
  summary: "Get suite run",
  description: "Returns a single suite run with per-test-case results.",
  security: [{ bearerAuth: [] }],
  request: { params: runIdParams },
  responses: {
    200: {
      description: "Suite run detail",
      content: {
        "application/json": { schema: evalSuiteRunResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Suite run not found"),
  },
});

router.openapi(getRunRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId, runId } = c.req.valid("param");
  const detail = await getEvalSuiteRunById(orgId, suiteId, runId);
  return c.json(formatSuiteRun(detail), 200);
});

// POST /:suiteId/test-cases — create manual test case
const createTestCaseRoute = createRoute({
  method: "post",
  path: "/{suiteId}/test-cases",
  tags: ["Eval Suites"],
  summary: "Create manual test case",
  description: "Creates a manual test case for an existing eval suite.",
  security: [{ bearerAuth: [] }],
  request: {
    params: suiteIdParams,
    body: {
      content: { "application/json": { schema: createTestCaseSchema } },
    },
  },
  responses: {
    201: {
      description: "Test case created",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            suiteId: z.string().uuid(),
            name: z.string(),
            description: z.string().nullable(),
            source: z.enum(["auto", "manual"]),
            order: z.number(),
            createdAt: z.string(),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval suite not found"),
  },
});

router.openapi(createTestCaseRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const body = c.req.valid("json");

  const testCase = await createTestCase(orgId, suiteId, body);

  return c.json(
    {
      id: testCase.id,
      suiteId: testCase.suiteId,
      name: testCase.name,
      description: testCase.description,
      source: testCase.source,
      order: testCase.order,
      createdAt: testCase.createdAt.toISOString(),
    },
    201,
  );
});

// POST /:suiteId/test-cases/:testCaseId/evaluators — create manual evaluator
const createEvaluatorRoute = createRoute({
  method: "post",
  path: "/{suiteId}/test-cases/{testCaseId}/evaluators",
  tags: ["Eval Suites"],
  summary: "Create manual evaluator",
  description:
    "Creates a manual evaluator for an existing test case. Links to an eval_config.",
  security: [{ bearerAuth: [] }],
  request: {
    params: testCaseParams,
    body: {
      content: { "application/json": { schema: createEvaluatorSchema } },
    },
  },
  responses: {
    201: {
      description: "Evaluator created",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            testCaseId: z.string().uuid(),
            evalConfigId: z.string().uuid(),
            name: z.string(),
            source: z.enum(["auto", "manual"]),
            order: z.number(),
            required: z.boolean(),
            createdAt: z.string(),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Suite or test case not found"),
  },
});

router.openapi(createEvaluatorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId, testCaseId } = c.req.valid("param");
  const body = c.req.valid("json");

  const evaluator = await createEvaluator(orgId, suiteId, testCaseId, body);

  return c.json(
    {
      id: evaluator.id,
      testCaseId: evaluator.testCaseId,
      evalConfigId: evaluator.evalConfigId,
      name: evaluator.name,
      source: evaluator.source,
      order: evaluator.order,
      required: evaluator.required,
      createdAt: evaluator.createdAt.toISOString(),
    },
    201,
  );
});

export default router;
