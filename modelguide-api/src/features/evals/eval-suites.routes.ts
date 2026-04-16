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
  enqueueGenerateTestCases,
  getGenerationStatus,
} from "@features/test-case-generation";
import { Errors } from "@lib/errors";
import { enqueueSimulateAndRun } from "./eval-suites-simulate.service";
import {
  createEvaluatorSchema,
  createSuiteSchema,
  createTestCaseEvaluatorSchema,
  createTestCaseSchema,
  evalSuiteListQuerySchema,
  evalSuiteResponseSchema,
  evalSuiteRunResponseSchema,
  evalSuiteRunsQuerySchema,
  evalSuiteSummaryResponseSchema,
  generateTestCasesResponseSchema,
  generateTestCasesSchema,
  generationTaskStatusResponseSchema,
  initSuiteFromSopSchema,
  runEvalSuiteSchema,
  simulateAndRunResponseSchema,
  simulateAndRunSchema,
} from "./eval-suites.schemas";
import {
  createEvaluator,
  createSuite,
  createTestCase,
  createTestCaseEvaluator,
  deleteEvalSuite,
  deleteSuiteEvaluator,
  deleteTestCaseEvaluator,
  getEvalSuiteById,
  getEvalSuiteRunById,
  getEvalSuiteRuns,
  getTestCaseEffectiveEvaluators,
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

const taskIdParams = z.object({
  taskId: z.string().uuid().openapi({ description: "Generation Task ID" }),
});

const suiteEvaluatorIdParams = z.object({
  suiteId: z.string().uuid().openapi({ description: "Eval Suite ID" }),
  evaluatorId: z.string().uuid().openapi({ description: "Suite Evaluator ID" }),
});

const testCaseIdParams = z.object({
  suiteId: z.string().uuid().openapi({ description: "Eval Suite ID" }),
  caseId: z.string().uuid().openapi({ description: "Test Case ID" }),
});

const testCaseEvaluatorIdParams = z.object({
  suiteId: z.string().uuid().openapi({ description: "Eval Suite ID" }),
  caseId: z.string().uuid().openapi({ description: "Test Case ID" }),
  overrideId: z.string().uuid().openapi({
    description: "Test Case Evaluator Override ID",
  }),
});

// ============================================================================
// Formatters
// ============================================================================

type SuiteDetail = Awaited<ReturnType<typeof getEvalSuiteById>>;
type SuiteRunDetail = Awaited<ReturnType<typeof getEvalSuiteRunById>>;

function formatEvaluator(a: SuiteDetail["evaluators"][number]) {
  return {
    id: a.id,
    suiteId: a.suiteId,
    evalConfigId: a.evalConfigId,
    name: a.name,
    sopStepId: a.sopStepId,
    source: a.source,
    order: a.order,
    required: a.required,
    tags: a.tags ?? [],
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
    evaluatorOverrides: tc.evaluatorOverrides?.map((o) => ({
      id: o.id,
      evalConfigId: o.evalConfigId,
      overrideType: o.overrideType,
      name: o.name,
      order: o.order,
      required: o.required,
      source: o.source,
      createdAt: o.createdAt.toISOString(),
    })),
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
    evaluators: s.evaluators.map(formatEvaluator),
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
    status: r.status,
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
      sessionId: tc.sessionId,
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
    status: r.status,
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
      sessionId: tc.sessionId,
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
router.post(
  "/:suiteId/simulate-and-run",
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
  "/:suiteId/generate-test-cases",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.get(
  "/generation-tasks/:taskId",
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
  "/:suiteId/evaluators",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.delete(
  "/:suiteId/evaluators/:evaluatorId",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.post(
  "/:suiteId/test-cases/:caseId/evaluators",
  requireUser(),
  requirePermission("eval_suites:create"),
  requireOrganization(),
);
router.get(
  "/:suiteId/test-cases/:caseId/evaluators",
  requireUser(),
  requirePermission("eval_suites:read"),
  requireOrganization(),
);
router.delete(
  "/:suiteId/test-cases/:caseId/evaluators/:overrideId",
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
    "Creates or re-initializes an eval suite for an agent+SOP pair. Derives evaluators from SOP steps and guardrails.",
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

// POST /:suiteId/simulate-and-run — async simulate + eval
const simulateAndRunRoute = createRoute({
  method: "post",
  path: "/{suiteId}/simulate-and-run",
  tags: ["Eval Suites"],
  summary: "Simulate and run eval suite",
  description:
    "Asynchronously simulates conversations for each test case using mock tools via MCP, then scores each session. Returns immediately with a suite run ID (HTTP 202). Poll GET /:suiteId/runs/:runId for progress. Requires `eval_suites:run` permission.",
  security: [{ bearerAuth: [] }],
  request: {
    params: suiteIdParams,
    body: {
      content: { "application/json": { schema: simulateAndRunSchema } },
    },
  },
  responses: {
    202: {
      description: "Suite run enqueued",
      content: {
        "application/json": { schema: simulateAndRunResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval suite not found"),
    409: errorResponse("Eval suite is archived"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(simulateAndRunRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const triggeredBy = auth.type === "user" ? auth.user.id : undefined;

  const result = await enqueueSimulateAndRun(
    orgId,
    suiteId,
    body.promptSource,
    {
      triggeredBy,
      testCaseIds: body.testCaseIds,
    },
  );

  return c.json(
    { suiteRunId: result.suiteRunId, status: "running" as const },
    202,
  );
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

// POST /:suiteId/generate-test-cases — async test case generation
const generateTestCasesRoute = createRoute({
  method: "post",
  path: "/{suiteId}/generate-test-cases",
  tags: ["Eval Suites"],
  summary: "Generate synthetic test cases",
  description:
    "Derives scenario dimensions from the suite's linked SOP and generates synthetic test cases via LLM. Returns immediately with a task ID (HTTP 202). Poll the task status for progress.",
  security: [{ bearerAuth: [] }],
  request: {
    params: suiteIdParams,
    body: {
      content: { "application/json": { schema: generateTestCasesSchema } },
    },
  },
  responses: {
    202: {
      description: "Generation task enqueued",
      content: {
        "application/json": { schema: generateTestCasesResponseSchema },
      },
    },
    400: errorResponse("Suite has no linked SOP"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval suite not found"),
  },
});

router.openapi(generateTestCasesRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await enqueueGenerateTestCases(orgId, suiteId, body.count);

  return c.json({ taskId: result.taskId, status: "running" as const }, 202);
});

// GET /generation-tasks/:taskId — poll generation task status
const getGenerationTaskStatusRoute = createRoute({
  method: "get",
  path: "/generation-tasks/{taskId}",
  tags: ["Eval Suites"],
  summary: "Get generation task status",
  description:
    "Returns the current status and progress of a test case generation task.",
  security: [{ bearerAuth: [] }],
  request: { params: taskIdParams },
  responses: {
    200: {
      description: "Generation task status",
      content: {
        "application/json": { schema: generationTaskStatusResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Task not found"),
  },
});

router.openapi(getGenerationTaskStatusRoute, async (c) => {
  const { taskId } = c.req.valid("param");
  const state = getGenerationStatus(taskId);

  if (!state) {
    throw Errors.notFound("Generation task not found");
  }

  const progress = state.progress as
    | {
        status: "deriving_dimensions" | "generating" | "completed" | "failed";
        completed: number;
        total: number;
        accepted: number;
        rejected: number;
        error?: string;
        result?: Record<string, unknown>;
      }
    | undefined;

  return c.json(
    {
      id: state.id,
      status: state.status,
      progress,
      error: state.error,
    },
    200,
  );
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

// POST /:suiteId/evaluators — create manual evaluator
const createEvaluatorRoute = createRoute({
  method: "post",
  path: "/{suiteId}/evaluators",
  tags: ["Eval Suites"],
  summary: "Create manual evaluator",
  description:
    "Creates a manual evaluator for an existing suite. Links to an eval_config.",
  security: [{ bearerAuth: [] }],
  request: {
    params: suiteIdParams,
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
            suiteId: z.string().uuid(),
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
    404: errorResponse("Suite not found"),
  },
});

router.openapi(createEvaluatorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId } = c.req.valid("param");
  const body = c.req.valid("json");

  const evaluator = await createEvaluator(orgId, suiteId, body);

  return c.json(
    {
      id: evaluator.id,
      suiteId: evaluator.suiteId,
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

// DELETE /:suiteId/evaluators/:evaluatorId — delete suite evaluator (AC 21)
const deleteSuiteEvaluatorRoute = createRoute({
  method: "delete",
  path: "/{suiteId}/evaluators/{evaluatorId}",
  tags: ["Eval Suites"],
  summary: "Delete suite evaluator",
  description:
    "Removes a suite-level evaluator. Cascades cleanup of related case-level exclude overrides.",
  security: [{ bearerAuth: [] }],
  request: { params: suiteEvaluatorIdParams },
  responses: {
    204: { description: "Evaluator deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Evaluator not found"),
  },
});

router.openapi(deleteSuiteEvaluatorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId, evaluatorId } = c.req.valid("param");
  await deleteSuiteEvaluator(orgId, suiteId, evaluatorId);
  return c.body(null, 204);
});

// POST /:suiteId/test-cases/:caseId/evaluators — create per-case evaluator override (AC 2)
const createTestCaseEvaluatorRoute = createRoute({
  method: "post",
  path: "/{suiteId}/test-cases/{caseId}/evaluators",
  tags: ["Eval Suites"],
  summary: "Create test case evaluator override",
  description:
    "Creates a per-case evaluator override (add or exclude). Adds append extra evaluators; excludes remove inherited suite evaluators.",
  security: [{ bearerAuth: [] }],
  request: {
    params: testCaseIdParams,
    body: {
      content: {
        "application/json": { schema: createTestCaseEvaluatorSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Override created",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            testCaseId: z.string().uuid(),
            evalConfigId: z.string().uuid(),
            overrideType: z.enum(["add", "exclude"]),
            name: z.string(),
            order: z.number(),
            required: z.boolean(),
            source: z.enum(["auto", "manual"]),
            createdAt: z.string(),
          }),
        },
      },
    },
    400: errorResponse("Validation error"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Not found"),
    409: errorResponse("Already exists"),
  },
});

router.openapi(createTestCaseEvaluatorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId, caseId } = c.req.valid("param");
  const body = c.req.valid("json");

  const override = await createTestCaseEvaluator(orgId, suiteId, caseId, body);

  return c.json(
    {
      id: override.id,
      testCaseId: override.testCaseId,
      evalConfigId: override.evalConfigId,
      overrideType: override.overrideType,
      name: override.name,
      order: override.order,
      required: override.required,
      source: override.source,
      createdAt: override.createdAt.toISOString(),
    },
    201,
  );
});

// GET /:suiteId/test-cases/:caseId/evaluators — get effective evaluators (AC 3)
const getTestCaseEvaluatorsRoute = createRoute({
  method: "get",
  path: "/{suiteId}/test-cases/{caseId}/evaluators",
  tags: ["Eval Suites"],
  summary: "Get test case effective evaluators",
  description:
    "Returns the effective evaluator list for a test case: inherited suite evaluators merged with case-level overrides.",
  security: [{ bearerAuth: [] }],
  request: { params: testCaseIdParams },
  responses: {
    200: {
      description: "Effective evaluator list",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string().uuid(),
                evalConfigId: z.string().uuid(),
                name: z.string(),
                order: z.number(),
                required: z.boolean(),
                source: z.enum(["inherited", "auto", "manual"]),
                overrideType: z.enum(["add", "exclude"]).optional(),
                sopStepId: z.string().nullable().optional(),
                tags: z.array(z.string()),
              }),
            ),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Test case not found"),
  },
});

router.openapi(getTestCaseEvaluatorsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId, caseId } = c.req.valid("param");

  const evaluators = await getTestCaseEffectiveEvaluators(
    orgId,
    suiteId,
    caseId,
  );

  return c.json({ data: evaluators }, 200);
});

// DELETE /:suiteId/test-cases/:caseId/evaluators/:overrideId — delete override (AC 4)
const deleteTestCaseEvaluatorRoute = createRoute({
  method: "delete",
  path: "/{suiteId}/test-cases/{caseId}/evaluators/{overrideId}",
  tags: ["Eval Suites"],
  summary: "Delete test case evaluator override",
  description: "Removes a per-case evaluator override.",
  security: [{ bearerAuth: [] }],
  request: { params: testCaseEvaluatorIdParams },
  responses: {
    204: { description: "Override deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Override not found"),
  },
});

router.openapi(deleteTestCaseEvaluatorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { suiteId, caseId, overrideId } = c.req.valid("param");
  await deleteTestCaseEvaluator(orgId, suiteId, caseId, overrideId);
  return c.body(null, 204);
});

export default router;
