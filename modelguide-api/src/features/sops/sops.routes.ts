/**
 * SOP management routes
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getOrganizationId,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { paginatedResponseSchema, paginationSchema } from "@lib/pagination";
import { errorResponse } from "@lib/schemas";
import type { SopSchema } from "./sops.types";

import {
  createSopSchema,
  createVersionSchema,
  forkFromTemplateSchema,
  setAgentsSchema,
  sopDetailResponseSchema,
  sopListQuerySchema,
  sopSummaryResponseSchema,
  sopTemplateResponseSchema,
  sopVersionResponseSchema,
  updateSopSchema,
} from "./sops.schemas";

import {
  activateSop,
  archiveSop,
  createSop,
  createVersion,
  deleteSop,
  forkFromTemplate,
  getAssignedAgents,
  getSopById,
  getTemplateById,
  getVersion,
  listSops,
  listTemplates,
  listVersions,
  setAssignedAgents,
  updateSop,
} from "./sops.service";

const router = createRouter();

// ============================================================================
// Param schemas
// ============================================================================

const idParams = z.object({
  id: z.string().uuid().openapi({ description: "SOP ID" }),
});

const templateIdParams = z.object({
  templateId: z.string().uuid().openapi({ description: "SOP Template ID" }),
});

const versionIdParams = z.object({
  id: z.string().uuid().openapi({ description: "SOP ID" }),
  versionId: z.string().uuid().openapi({ description: "Version ID" }),
});

// ============================================================================
// Helpers — typed formatters using service return types
// ============================================================================

type SopStatus = "draft" | "active" | "archived";

type ServiceTemplate = Awaited<ReturnType<typeof getTemplateById>>;
function formatTemplate(t: ServiceTemplate) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    description: t.description,
    catalogSlugs: t.catalogSlugs ?? [],
    definition: t.definition as unknown as SopSchema,
    version: t.version,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt?.toISOString() ?? null,
  };
}

type ServiceSopSummary = Awaited<ReturnType<typeof listSops>>["data"][number];
function formatSopSummary(s: ServiceSopSummary) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    status: s.status as SopStatus,
    version: s.version,
    assignedAgents: s.assignedAgents,
    templateId: s.templateId,
    templateName: s.templateName ?? null,
    stepCount: s.stepCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

type ServiceSopDetail = Awaited<ReturnType<typeof getSopById>>;
function formatSopDetail(s: ServiceSopDetail) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    status: s.status as SopStatus,
    version: s.version,
    assignedAgents: s.assignedAgents,
    templateId: s.templateId,
    template: s.template,
    definition: s.definition as unknown as SopSchema,
    stepWarnings: s.stepWarnings,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

type ServiceVersion = Awaited<ReturnType<typeof getVersion>>;
function formatVersion(v: ServiceVersion) {
  return {
    id: v.id,
    sopId: v.sopId,
    version: v.version,
    definition: v.definition as unknown as SopSchema,
    changeSummary: v.changeSummary,
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
  };
}

// ============================================================================
// Middleware registration
// ============================================================================

// Templates
router.get(
  "/templates",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);
router.get(
  "/templates/:templateId",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);

// CRUD
router.get(
  "/",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("sops:create"),
  requireOrganization(),
);
router.post(
  "/from-template/:templateId",
  requireUser(),
  requirePermission("sops:create"),
  requireOrganization(),
);
router.get(
  "/:id",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);
router.patch(
  "/:id",
  requireUser(),
  requirePermission("sops:update"),
  requireOrganization(),
);
router.delete(
  "/:id",
  requireUser(),
  requirePermission("sops:delete"),
  requireOrganization(),
);

// Status transitions
router.post(
  "/:id/activate",
  requireUser(),
  requirePermission("sops:update"),
  requireOrganization(),
);
router.post(
  "/:id/archive",
  requireUser(),
  requirePermission("sops:update"),
  requireOrganization(),
);

// Agent assignments
router.get(
  "/:id/agents",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);
router.put(
  "/:id/agents",
  requireUser(),
  requirePermission("sops:update"),
  requireOrganization(),
);

// Versions
router.get(
  "/:id/versions",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);
router.post(
  "/:id/versions",
  requireUser(),
  requirePermission("sops:update"),
  requireOrganization(),
);
router.get(
  "/:id/versions/:versionId",
  requireUser(),
  requirePermission("sops:read"),
  requireOrganization(),
);

// ============================================================================
// Template routes
// ============================================================================

const listTemplatesRoute = createRoute({
  method: "get",
  path: "/templates",
  tags: ["SOPs"],
  summary: "List SOP templates",
  description: "Returns paginated list of active SOP templates.",
  security: [{ bearerAuth: [] }],
  request: { query: paginationSchema },
  responses: {
    200: {
      description: "Paginated list of SOP templates",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(sopTemplateResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listTemplatesRoute, async (c) => {
  const query = c.req.valid("query");
  const result = await listTemplates(query);
  return c.json(
    { data: result.data.map(formatTemplate), pagination: result.pagination },
    200,
  );
});

const getTemplateRoute = createRoute({
  method: "get",
  path: "/templates/{templateId}",
  tags: ["SOPs"],
  summary: "Get SOP template",
  description: "Returns a single SOP template.",
  security: [{ bearerAuth: [] }],
  request: { params: templateIdParams },
  responses: {
    200: {
      description: "SOP template detail",
      content: {
        "application/json": { schema: sopTemplateResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Template not found"),
  },
});

router.openapi(getTemplateRoute, async (c) => {
  const { templateId } = c.req.valid("param");
  const template = await getTemplateById(templateId);
  return c.json(formatTemplate(template), 200);
});

// ============================================================================
// SOP routes
// ============================================================================

const listSopsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["SOPs"],
  summary: "List SOPs",
  description: "Returns paginated list of org SOPs with filters.",
  security: [{ bearerAuth: [] }],
  request: { query: sopListQuerySchema },
  responses: {
    200: {
      description: "Paginated list of SOPs",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(sopSummaryResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listSopsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");
  const result = await listSops(orgId, query);
  return c.json(
    { data: result.data.map(formatSopSummary), pagination: result.pagination },
    200,
  );
});

const createSopRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["SOPs"],
  summary: "Create SOP",
  description: "Creates a new SOP from scratch.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createSopSchema } },
    },
  },
  responses: {
    201: {
      description: "SOP created",
      content: {
        "application/json": { schema: sopDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    409: errorResponse("Slug already exists"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createSopRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;

  const sop = await createSop(
    orgId,
    body as {
      name: string;
      slug?: string;
      description?: string;
      definition: SopSchema;
      agentIds?: string[];
    },
    createdBy,
  );

  const detail = await getSopById(orgId, sop.id);
  return c.json(formatSopDetail(detail), 201);
});

const forkRoute = createRoute({
  method: "post",
  path: "/from-template/{templateId}",
  tags: ["SOPs"],
  summary: "Fork SOP from template",
  description:
    "Creates a new SOP by forking from a template, mapping catalog slugs to org connectors.",
  security: [{ bearerAuth: [] }],
  request: {
    params: templateIdParams,
    body: {
      content: { "application/json": { schema: forkFromTemplateSchema } },
    },
  },
  responses: {
    201: {
      description: "SOP forked from template",
      content: {
        "application/json": { schema: sopDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Template not found"),
    409: errorResponse("Slug already exists"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(forkRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { templateId } = c.req.valid("param");
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;

  const sop = await forkFromTemplate(orgId, templateId, body, createdBy);
  const detail = await getSopById(orgId, sop.id);
  return c.json(formatSopDetail(detail), 201);
});

const getSopRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["SOPs"],
  summary: "Get SOP",
  description: "Returns a single SOP with step warnings.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: {
      description: "SOP detail",
      content: {
        "application/json": { schema: sopDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(getSopRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const detail = await getSopById(orgId, id);
  return c.json(formatSopDetail(detail), 200);
});

const updateSopRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["SOPs"],
  summary: "Update SOP",
  description: "Updates SOP name, description, definition, or version.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: {
      content: { "application/json": { schema: updateSopSchema } },
    },
  },
  responses: {
    200: {
      description: "SOP updated",
      content: {
        "application/json": { schema: sopDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("SOP not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateSopRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  await updateSop(orgId, id, body as Parameters<typeof updateSop>[2]);
  const detail = await getSopById(orgId, id);
  return c.json(formatSopDetail(detail), 200);
});

const deleteSopRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["SOPs"],
  summary: "Delete SOP",
  description: "Deletes an SOP and all related data (cascade).",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    204: { description: "SOP deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(deleteSopRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  await deleteSop(orgId, id);
  return c.body(null, 204);
});

// ============================================================================
// Status transitions
// ============================================================================

const activateRoute = createRoute({
  method: "post",
  path: "/{id}/activate",
  tags: ["SOPs"],
  summary: "Activate SOP",
  description: "Sets SOP status to active. Requires at least one step.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: {
      description: "SOP activated",
      content: {
        "application/json": { schema: sopDetailResponseSchema },
      },
    },
    400: errorResponse("Cannot activate SOP with no steps"),
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(activateRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  await activateSop(orgId, id);
  const detail = await getSopById(orgId, id);
  return c.json(formatSopDetail(detail), 200);
});

const archiveRoute = createRoute({
  method: "post",
  path: "/{id}/archive",
  tags: ["SOPs"],
  summary: "Archive SOP",
  description: "Sets SOP status to archived.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: {
      description: "SOP archived",
      content: {
        "application/json": { schema: sopDetailResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(archiveRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  await archiveSop(orgId, id);
  const detail = await getSopById(orgId, id);
  return c.json(formatSopDetail(detail), 200);
});

// ============================================================================
// Agent assignments
// ============================================================================

const getAgentsRoute = createRoute({
  method: "get",
  path: "/{id}/agents",
  tags: ["SOPs"],
  summary: "List assigned agents",
  description: "Returns agents assigned to this SOP.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: {
      description: "Assigned agents",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                modality: z.string(),
              }),
            ),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(getAgentsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const assignedAgents = await getAssignedAgents(orgId, id);
  return c.json({ data: assignedAgents }, 200);
});

const setAgentsRoute = createRoute({
  method: "put",
  path: "/{id}/agents",
  tags: ["SOPs"],
  summary: "Set assigned agents",
  description: "Replaces all agent assignments for this SOP.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: {
      content: { "application/json": { schema: setAgentsSchema } },
    },
  },
  responses: {
    200: {
      description: "Agent assignments updated",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                modality: z.string(),
              }),
            ),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("SOP or agent not found"),
  },
});

router.openapi(setAgentsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const { agentIds } = c.req.valid("json");
  const assignedAgents = await setAssignedAgents(orgId, id, agentIds);
  return c.json({ data: assignedAgents }, 200);
});

// ============================================================================
// Version routes
// ============================================================================

const listVersionsRoute = createRoute({
  method: "get",
  path: "/{id}/versions",
  tags: ["SOPs"],
  summary: "List SOP versions",
  description: "Returns version history for an SOP.",
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: {
      description: "Version history",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(sopVersionResponseSchema),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(listVersionsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const versions = await listVersions(orgId, id);
  return c.json({ data: versions.map(formatVersion) }, 200);
});

const createVersionRoute = createRoute({
  method: "post",
  path: "/{id}/versions",
  tags: ["SOPs"],
  summary: "Create version snapshot",
  description: "Creates a snapshot of the current SOP definition.",
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: {
      content: { "application/json": { schema: createVersionSchema } },
    },
  },
  responses: {
    201: {
      description: "Version created",
      content: {
        "application/json": { schema: sopVersionResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP not found"),
  },
});

router.openapi(createVersionRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const auth = c.get("auth");
  const createdBy = auth.type === "user" ? auth.user.id : undefined;
  const version = await createVersion(orgId, id, body, createdBy);
  return c.json(formatVersion(version), 201);
});

const getVersionRoute = createRoute({
  method: "get",
  path: "/{id}/versions/{versionId}",
  tags: ["SOPs"],
  summary: "Get version detail",
  description: "Returns a specific version snapshot.",
  security: [{ bearerAuth: [] }],
  request: { params: versionIdParams },
  responses: {
    200: {
      description: "Version detail",
      content: {
        "application/json": { schema: sopVersionResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("SOP or version not found"),
  },
});

router.openapi(getVersionRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id, versionId } = c.req.valid("param");
  const version = await getVersion(orgId, id, versionId);
  return c.json(formatVersion(version), 200);
});

export default router;
