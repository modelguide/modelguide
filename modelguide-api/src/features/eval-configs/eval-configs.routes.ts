/**
 * Eval config management routes.
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
  createEvalConfigSchema,
  evalConfigListQuerySchema,
  evalConfigResponseSchema,
  updateEvalConfigSchema,
} from "./eval-configs.schemas";

import {
  createEvalConfig,
  deleteEvalConfig,
  getEvalConfigById,
  listEvalConfigs,
  updateEvalConfig,
} from "./eval-configs.service";

const router = createRouter();

// ============================================================================
// Param schemas
// ============================================================================

const configIdParams = z.object({
  configId: z.string().uuid().openapi({ description: "Eval Config ID" }),
});

// ============================================================================
// Helpers
// ============================================================================

type ServiceConfig = Awaited<ReturnType<typeof getEvalConfigById>>;
function formatConfig(c: ServiceConfig) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    evaluatorType: c.evaluatorType,
    config: c.config,
    tags: c.tags ?? [],
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt?.toISOString() ?? null,
  };
}

// ============================================================================
// Middleware registration
// ============================================================================

router.get(
  "/",
  requireUser(),
  requirePermission("eval_configs:read"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("eval_configs:create"),
  requireOrganization(),
);
router.get(
  "/:configId",
  requireUser(),
  requirePermission("eval_configs:read"),
  requireOrganization(),
);
router.put(
  "/:configId",
  requireUser(),
  requirePermission("eval_configs:update"),
  requireOrganization(),
);
router.delete(
  "/:configId",
  requireUser(),
  requirePermission("eval_configs:delete"),
  requireOrganization(),
);

// ============================================================================
// Routes
// ============================================================================

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Eval Configs"],
  summary: "List eval configs",
  description: "Returns paginated list of eval configs for the organization.",
  security: [{ bearerAuth: [] }],
  request: { query: evalConfigListQuerySchema },
  responses: {
    200: {
      description: "Paginated list of eval configs",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(evalConfigResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");
  const result = await listEvalConfigs(orgId, query);
  return c.json(
    { data: result.data.map(formatConfig), pagination: result.pagination },
    200,
  );
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Eval Configs"],
  summary: "Create eval config",
  description: "Creates a new eval config.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createEvalConfigSchema } },
    },
  },
  responses: {
    201: {
      description: "Eval config created",
      content: {
        "application/json": { schema: evalConfigResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createRoute_, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;

  const config = await createEvalConfig(orgId, body, createdBy);
  return c.json(formatConfig(config), 201);
});

const getRoute = createRoute({
  method: "get",
  path: "/{configId}",
  tags: ["Eval Configs"],
  summary: "Get eval config",
  description: "Returns a single eval config.",
  security: [{ bearerAuth: [] }],
  request: { params: configIdParams },
  responses: {
    200: {
      description: "Eval config detail",
      content: {
        "application/json": { schema: evalConfigResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Eval config not found"),
  },
});

router.openapi(getRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { configId } = c.req.valid("param");
  const config = await getEvalConfigById(orgId, configId);
  return c.json(formatConfig(config), 200);
});

const updateRoute = createRoute({
  method: "put",
  path: "/{configId}",
  tags: ["Eval Configs"],
  summary: "Update eval config",
  description:
    "Updates an eval config. evaluatorType is immutable after creation.",
  security: [{ bearerAuth: [] }],
  request: {
    params: configIdParams,
    body: {
      content: { "application/json": { schema: updateEvalConfigSchema } },
    },
  },
  responses: {
    200: {
      description: "Eval config updated",
      content: {
        "application/json": { schema: evalConfigResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval config not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { configId } = c.req.valid("param");
  const body = c.req.valid("json");
  const updated = await updateEvalConfig(orgId, configId, body);
  return c.json(formatConfig(updated), 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{configId}",
  tags: ["Eval Configs"],
  summary: "Delete eval config",
  description: "Deletes an eval config. Fails if referenced by any SOP steps.",
  security: [{ bearerAuth: [] }],
  request: { params: configIdParams },
  responses: {
    204: { description: "Eval config deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Eval config not found"),
    409: errorResponse("Eval config in use"),
  },
});

router.openapi(deleteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { configId } = c.req.valid("param");
  await deleteEvalConfig(orgId, configId);
  return c.body(null, 204);
});

export default router;
