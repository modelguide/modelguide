/**
 * Knowledge Base routes — CRUD for guardrails (and future KB types).
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
  createKnowledgeBaseSchema,
  knowledgeBaseDetailResponseSchema,
  knowledgeBaseListQuerySchema,
  knowledgeBaseSummaryResponseSchema,
  updateKnowledgeBaseSchema,
} from "./knowledge-base.schemas";

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  listKnowledgeBase,
  updateKnowledgeBase,
} from "./knowledge-base.service";

const router = createRouter();

// ============================================================================
// Param schemas
// ============================================================================

const idParams = z.object({
  id: z.string().uuid().openapi({ description: "Knowledge Base item ID" }),
});

// ============================================================================
// Helpers — typed formatters
// ============================================================================

type ServiceSummary = Awaited<
  ReturnType<typeof listKnowledgeBase>
>["data"][number];
function formatSummary(item: ServiceSummary) {
  return {
    id: item.id,
    type: item.type as "guardrail",
    name: item.name,
    slug: item.slug,
    content: item.content,
    description: item.description,
    config: item.config as Record<string, unknown>,
    isActive: item.isActive,
    assignedAgents: item.assignedAgents,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt?.toISOString() ?? null,
  };
}

type ServiceDetail = Awaited<ReturnType<typeof getKnowledgeBaseById>>;
function formatDetail(item: ServiceDetail) {
  return {
    ...formatSummary(item),
    createdBy: item.createdBy,
  };
}

// ============================================================================
// Middleware registration
// ============================================================================

router.get(
  "/",
  requireUser(),
  requirePermission("knowledge_base:read"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("knowledge_base:create"),
  requireOrganization(),
);
router.get(
  "/:id",
  requireUser(),
  requirePermission("knowledge_base:read"),
  requireOrganization(),
);
router.patch(
  "/:id",
  requireUser(),
  requirePermission("knowledge_base:update"),
  requireOrganization(),
);
router.delete(
  "/:id",
  requireUser(),
  requirePermission("knowledge_base:delete"),
  requireOrganization(),
);

// ============================================================================
// Route definitions
// ============================================================================

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Knowledge Base"],
  summary: "List knowledge base items",
  description:
    "Returns paginated list of knowledge base items with optional filters.",
  security: [{ bearerAuth: [] }],
  request: { query: knowledgeBaseListQuerySchema },
  responses: {
    200: {
      description: "Paginated list of knowledge base items",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(knowledgeBaseSummaryResponseSchema),
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
  const result = await listKnowledgeBase(orgId, query);
  return c.json(
    { data: result.data.map(formatSummary), pagination: result.pagination },
    200,
  );
});

const createRoute_ = createRoute({
  method: "post",
  path: "/",
  tags: ["Knowledge Base"],
  summary: "Create knowledge base item",
  description: "Creates a new knowledge base item (e.g. guardrail rule).",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createKnowledgeBaseSchema } },
    },
  },
  responses: {
    201: {
      description: "Created knowledge base item",
      content: {
        "application/json": { schema: knowledgeBaseDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    409: errorResponse("Slug already exists"),
  },
});

router.openapi(createRoute_, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;

  const item = await createKnowledgeBase(orgId, { ...body, createdBy });
  return c.json(formatDetail(item), 201);
});

const getByIdRoute = createRoute({
  method: "get",
  path: "/:id",
  tags: ["Knowledge Base"],
  summary: "Get knowledge base item",
  description: "Returns a single knowledge base item with assigned agents.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: {
      description: "Knowledge base item detail",
      content: {
        "application/json": { schema: knowledgeBaseDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Not found"),
  },
});

router.openapi(getByIdRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const item = await getKnowledgeBaseById(orgId, id);
  return c.json(formatDetail(item), 200);
});

const updateRoute = createRoute({
  method: "patch",
  path: "/:id",
  tags: ["Knowledge Base"],
  summary: "Update knowledge base item",
  description: "Updates a knowledge base item. Supports partial updates.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: {
      content: { "application/json": { schema: updateKnowledgeBaseSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated knowledge base item",
      content: {
        "application/json": { schema: knowledgeBaseDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Not found"),
  },
});

router.openapi(updateRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const item = await updateKnowledgeBase(orgId, id, body);
  return c.json(formatDetail(item), 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/:id",
  tags: ["Knowledge Base"],
  summary: "Delete knowledge base item",
  description: "Permanently deletes a knowledge base item.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    204: { description: "Deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Not found"),
  },
});

router.openapi(deleteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  await deleteKnowledgeBase(orgId, id);
  return c.body(null, 204);
});

export default router;
