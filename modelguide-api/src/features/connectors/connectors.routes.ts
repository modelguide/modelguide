/**
 * Connector management routes
 */

import type { Connector, ConnectorCatalog, ConnectorTool } from "@db/schema";
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
import {
  createConnector,
  deleteConnector,
  getCatalogEntry,
  getConnectorById,
  listCatalog,
  listConnectorTools,
  listConnectors,
  updateConnector,
  updateConnectorTool,
} from "./connectors.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const catalogToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
  defaultRequiresConfirmation: z.boolean(),
  defaultTimeoutSeconds: z.number(),
});

const catalogResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  connectorType: z.enum(["api", "webhook", "database", "messaging"]),
  configSchema: z.record(z.unknown()),
  tools: z.array(catalogToolSchema),
  authMethods: z.array(z.string()).nullable(),
  iconUrl: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

const connectorResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  connectorCatalogId: z.string().uuid(),
  config: z.record(z.unknown()),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const connectorToolResponseSchema = z.object({
  id: z.string().uuid(),
  connectorId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  toolSchema: z.record(z.unknown()),
  timeoutSeconds: z.number(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

const createConnectorSchema = z.object({
  connectorCatalogId: z.string().uuid().openapi({
    description: "ID of the catalog entry to create from",
  }),
  name: z.string().min(1).max(255).openapi({
    example: "My Medusa Store",
  }),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/,
      "Slug must start with a letter or number and contain only lowercase letters, numbers, hyphens, or underscores",
    )
    .openapi({
      example: "my-medusa-store",
    }),
  config: z.record(z.unknown()).optional().openapi({
    description: "Connector configuration",
  }),
});

const updateConnectorSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    config: z.record(z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.config !== undefined ||
      data.isActive !== undefined,
    {
      message:
        "At least one of 'name', 'config', or 'isActive' must be provided",
    },
  );

const updateToolSchema = z
  .object({
    isActive: z.boolean().optional(),
    timeoutSeconds: z.number().int().min(1).max(300).optional(),
  })
  .refine(
    (data) => data.isActive !== undefined || data.timeoutSeconds !== undefined,
    {
      message:
        "At least one of 'isActive' or 'timeoutSeconds' must be provided",
    },
  );

const catalogIdParams = z.object({
  catalogId: z.string().uuid().openapi({
    description: "Catalog entry ID",
  }),
});

const connectorIdParams = z.object({
  id: z.string().uuid().openapi({
    description: "Connector ID",
  }),
});

const toolIdParams = z.object({
  toolId: z.string().uuid().openapi({
    description: "Tool ID",
  }),
});

// ============================================================================
// Helpers
// ============================================================================

function formatCatalog(entry: ConnectorCatalog) {
  return {
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    description: entry.description,
    connectorType: entry.connectorType,
    configSchema: entry.configSchema ?? {},
    tools: entry.tools ?? [],
    authMethods: entry.authMethods,
    iconUrl: entry.iconUrl,
    isActive: entry.isActive,
    createdAt: entry.createdAt.toISOString(),
  };
}

function formatConnector(connector: Connector) {
  return {
    id: connector.id,
    name: connector.name,
    slug: connector.slug,
    connectorCatalogId: connector.connectorCatalogId,
    config: connector.config ?? {},
    isActive: connector.isActive,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt?.toISOString() ?? null,
  };
}

function formatTool(tool: ConnectorTool) {
  return {
    id: tool.id,
    connectorId: tool.connectorId,
    name: tool.name,
    slug: tool.slug,
    description: tool.description,
    toolSchema: tool.toolSchema ?? {},
    timeoutSeconds: tool.timeoutSeconds,
    isActive: tool.isActive,
    createdAt: tool.createdAt.toISOString(),
  };
}

// ============================================================================
// Routes
// ============================================================================

// GET /catalog
router.get(
  "/catalog",
  requireUser(),
  requirePermission("connectors:read"),
  requireOrganization(),
);
router.get(
  "/catalog/:catalogId",
  requireUser(),
  requirePermission("connectors:read"),
  requireOrganization(),
);
const listCatalogRoute = createRoute({
  method: "get",
  path: "/catalog",
  tags: ["Connectors"],
  summary: "List connector catalog",
  description: "Returns paginated list of active connector catalog entries.",
  security: [{ bearerAuth: [] }],
  request: {
    query: paginationSchema,
  },
  responses: {
    200: {
      description: "Paginated list of catalog entries",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(catalogResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listCatalogRoute, async (c) => {
  const query = c.req.valid("query");
  const result = await listCatalog(query);

  return c.json(
    {
      data: result.data.map(formatCatalog),
      pagination: result.pagination,
    },
    200,
  );
});

// GET /catalog/:catalogId
const getCatalogRoute = createRoute({
  method: "get",
  path: "/catalog/{catalogId}",
  tags: ["Connectors"],
  summary: "Get catalog entry",
  description: "Returns a single connector catalog entry with tools array.",
  security: [{ bearerAuth: [] }],
  request: {
    params: catalogIdParams,
  },
  responses: {
    200: {
      description: "Catalog entry detail",
      content: {
        "application/json": { schema: catalogResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Catalog entry not found"),
  },
});

router.openapi(getCatalogRoute, async (c) => {
  const { catalogId } = c.req.valid("param");
  const entry = await getCatalogEntry(catalogId);

  return c.json(formatCatalog(entry), 200);
});

// GET /
router.get(
  "/",
  requireUser(),
  requirePermission("connectors:read"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("connectors:create"),
  requireOrganization(),
);

const listConnectorsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Connectors"],
  summary: "List connectors",
  description: "Returns paginated list of organization connector instances.",
  security: [{ bearerAuth: [] }],
  request: {
    query: paginationSchema,
  },
  responses: {
    200: {
      description: "Paginated list of connectors",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(connectorResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listConnectorsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");
  const result = await listConnectors(orgId, query);

  return c.json(
    {
      data: result.data.map(formatConnector),
      pagination: result.pagination,
    },
    200,
  );
});

// POST /
const createConnectorRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Connectors"],
  summary: "Create connector",
  description:
    "Creates a new connector instance from a catalog entry. Auto-creates connector tools.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createConnectorSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Connector created",
      content: {
        "application/json": { schema: connectorResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Catalog entry not found"),
    409: errorResponse("Connector slug already exists"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createConnectorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");
  const connector = await createConnector(orgId, body);

  return c.json(formatConnector(connector), 201);
});

// GET /:id
router.get(
  "/:id",
  requireUser(),
  requirePermission("connectors:read"),
  requireOrganization(),
);
router.patch(
  "/:id",
  requireUser(),
  requirePermission("connectors:update"),
  requireOrganization(),
);
router.delete(
  "/:id",
  requireUser(),
  requirePermission("connectors:delete"),
  requireOrganization(),
);

const getConnectorRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Connectors"],
  summary: "Get connector",
  description: "Returns a single connector instance.",
  security: [{ bearerAuth: [] }],
  request: {
    params: connectorIdParams,
  },
  responses: {
    200: {
      description: "Connector detail",
      content: {
        "application/json": { schema: connectorResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Connector not found"),
  },
});

router.openapi(getConnectorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const connector = await getConnectorById(orgId, id);

  return c.json(formatConnector(connector), 200);
});

// PATCH /:id
const updateConnectorRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Connectors"],
  summary: "Update connector",
  description: "Updates a connector's name, config, or active status.",
  security: [{ bearerAuth: [] }],
  request: {
    params: connectorIdParams,
    body: {
      content: {
        "application/json": { schema: updateConnectorSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Connector updated",
      content: {
        "application/json": { schema: connectorResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Connector not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateConnectorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const connector = await updateConnector(orgId, id, body);

  return c.json(formatConnector(connector), 200);
});

// DELETE /:id
const deleteConnectorRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Connectors"],
  summary: "Delete connector",
  description:
    "Deletes a connector and all its tools (cascade via foreign key).",
  security: [{ bearerAuth: [] }],
  request: {
    params: connectorIdParams,
  },
  responses: {
    204: { description: "Connector deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Connector not found"),
  },
});

router.openapi(deleteConnectorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  await deleteConnector(orgId, id);

  return c.body(null, 204);
});

// GET /:id/tools
router.get(
  "/:id/tools",
  requireUser(),
  requirePermission("tools:read"),
  requireOrganization(),
);
router.patch(
  "/tools/:toolId",
  requireUser(),
  requirePermission("connectors:update"),
  requireOrganization(),
);

const listToolsRoute = createRoute({
  method: "get",
  path: "/{id}/tools",
  tags: ["Connectors"],
  summary: "List connector tools",
  description: "Returns all tools for a connector instance.",
  security: [{ bearerAuth: [] }],
  request: {
    params: connectorIdParams,
  },
  responses: {
    200: {
      description: "List of connector tools",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(connectorToolResponseSchema),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Connector not found"),
  },
});

router.openapi(listToolsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const tools = await listConnectorTools(orgId, id);

  return c.json({ data: tools.map(formatTool) }, 200);
});

// PATCH /tools/:toolId
const updateToolRoute = createRoute({
  method: "patch",
  path: "/tools/{toolId}",
  tags: ["Connectors"],
  summary: "Update connector tool",
  description: "Updates a tool's active status or timeout.",
  security: [{ bearerAuth: [] }],
  request: {
    params: toolIdParams,
    body: {
      content: {
        "application/json": { schema: updateToolSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Tool updated",
      content: {
        "application/json": { schema: connectorToolResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Tool not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateToolRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { toolId } = c.req.valid("param");
  const body = c.req.valid("json");
  const tool = await updateConnectorTool(orgId, toolId, body);

  return c.json(formatTool(tool), 200);
});

export default router;
