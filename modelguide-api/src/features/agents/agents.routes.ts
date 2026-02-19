/**
 * Agent management routes
 */

import { env } from "@/env";
import type { Agent } from "@db/schema";
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getCurrentUser,
  getOrganizationId,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { paginatedResponseSchema, paginationSchema } from "@lib/pagination";
import { errorResponse } from "@lib/schemas";
import {
  assignConnectorToAgent,
  createAgent,
  deleteAgent,
  getAgentById,
  listAgentConnectors,
  listAgents,
  regenerateApiKey,
  removeConnectorFromAgent,
  setAgentActive,
  updateAgent,
  updateAgentConnectorTools,
  upsertAgentPlatformKey,
} from "./agents.service";
import { syncAgentToElevenLabs } from "./agents.sync";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const agentResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  modality: z.enum(["voice", "text"]),
  agentPlatform: z.enum(["custom", "elevenlabs"]),
  isActive: z.boolean(),
  metadata: z.record(z.unknown()).optional(),
  hasElevenLabsKey: z.boolean(),
  hasWebhookSecret: z.boolean(),
  keyPrefix: z.string().nullable(),
  integrationUrls: z
    .object({
      sessionInit: z.string(),
      mcp: z.string(),
      postCallWebhook: z.string(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const agentWithKeyResponseSchema = agentResponseSchema.extend({
  apiKey: z.string(),
});

const agentConnectorToolSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  isEnabled: z.boolean(),
  requiresConfirmation: z.boolean(),
});

const agentConnectorResponseSchema = z.object({
  connectorId: z.string().uuid(),
  connectorSlug: z.string(),
  connectorName: z.string(),
  connectorIconUrl: z.string().nullable(),
  tools: z.array(agentConnectorToolSchema),
});

const regenerateKeyResponseSchema = z.object({
  apiKey: z.string(),
  keyPrefix: z.string(),
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(255).openapi({ example: "Order Agent" }),
  slug: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: "Auto-generated from name if omitted" }),
  description: z.string().optional(),
  modality: z.enum(["voice", "text"]).default("voice").optional(),
  agentPlatform: z.enum(["custom", "elevenlabs"]).default("custom").optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    agentPlatform: z.enum(["custom", "elevenlabs"]).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.metadata !== undefined ||
      data.agentPlatform !== undefined,
    {
      message: "At least one field must be provided",
    },
  );

const assignConnectorSchema = z.object({
  connectorId: z.string().uuid().openapi({ description: "Connector ID" }),
  tools: z.array(
    z.object({
      slug: z.string().openapi({ description: "Tool slug" }),
      isEnabled: z.boolean().optional().default(true),
      requiresConfirmation: z.boolean().optional().default(false),
    }),
  ),
});

const updateConnectorToolsSchema = z.object({
  tools: z.array(
    z.object({
      slug: z.string().openapi({ description: "Tool slug" }),
      isEnabled: z.boolean().optional(),
      requiresConfirmation: z.boolean().optional(),
    }),
  ),
});

const listAgentsQuerySchema = paginationSchema.extend({
  isActive: z.coerce
    .boolean()
    .optional()
    .openapi({ description: "Filter by active status" }),
  modality: z
    .enum(["voice", "text"])
    .optional()
    .openapi({ description: "Filter by modality" }),
  agentPlatform: z
    .enum(["custom", "elevenlabs"])
    .optional()
    .openapi({ description: "Filter by agent platform" }),
});

const agentIdParams = z.object({
  id: z.string().uuid().openapi({ description: "Agent ID" }),
});

const agentConnectorParams = z.object({
  id: z.string().uuid().openapi({ description: "Agent ID" }),
  connectorId: z.string().uuid().openapi({ description: "Connector ID" }),
});

// ============================================================================
// Helpers
// ============================================================================

function formatAgent(
  agent: Agent & {
    keyPrefix?: string | null;
    hasElevenLabsKey?: boolean;
    hasWebhookSecret?: boolean;
  },
) {
  // Strip webhook_hmac_secret from metadata to prevent plaintext leak
  const metadata = agent.metadata
    ? (() => {
        const { webhook_hmac_secret, ...rest } = agent.metadata as Record<
          string,
          unknown
        >;
        return Object.keys(rest).length > 0 ? rest : undefined;
      })()
    : undefined;

  const externalBase = (env.API_EXTERNAL_ADDRESS || env.APP_URL).replace(
    /\/$/,
    "",
  );

  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    modality: agent.modality,
    agentPlatform: agent.agentPlatform,
    isActive: agent.isActive,
    metadata,
    hasElevenLabsKey: agent.hasElevenLabsKey ?? false,
    hasWebhookSecret: agent.hasWebhookSecret ?? false,
    keyPrefix: agent.keyPrefix ?? null,
    integrationUrls: {
      sessionInit: `${externalBase}/api/sessions`,
      mcp: `${externalBase}/mcp/${agent.id}`,
      postCallWebhook: `${externalBase}/webhooks/elevenlabs/${agent.id}/post-call`,
    },
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt?.toISOString() ?? null,
  };
}

// ============================================================================
// Routes
// ============================================================================

// GET /
router.get(
  "/",
  requireUser(),
  requirePermission("agents:read"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("agents:create"),
  requireOrganization(),
);

const listAgentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  summary: "List agents",
  description:
    "Returns paginated list of agents for the organization. Optional filters by active status and agent type.",
  security: [{ bearerAuth: [] }],
  request: {
    query: listAgentsQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated list of agents",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(agentResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listAgentsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { page, pageSize, isActive, modality, agentPlatform } =
    c.req.valid("query");
  const result = await listAgents(
    orgId,
    { page, pageSize },
    { isActive, modality, agentPlatform },
  );

  return c.json(
    {
      data: result.data.map(formatAgent),
      pagination: result.pagination,
    },
    200,
  );
});

// POST /
const createAgentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Agents"],
  summary: "Create agent",
  description:
    "Creates a new agent (inactive by default) and generates an API key. The API key is returned once and cannot be retrieved again.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createAgentSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Agent created with API key",
      content: {
        "application/json": { schema: agentWithKeyResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const user = getCurrentUser(c);
  const body = c.req.valid("json");
  const { agent, apiKey } = await createAgent(orgId, body, user.id);

  return c.json({ ...formatAgent(agent), apiKey }, 201);
});

// GET /:id
router.get(
  "/:id",
  requireUser(),
  requirePermission("agents:read"),
  requireOrganization(),
);
router.patch(
  "/:id",
  requireUser(),
  requirePermission("agents:update"),
  requireOrganization(),
);
router.delete(
  "/:id",
  requireUser(),
  requirePermission("agents:delete"),
  requireOrganization(),
);

const getAgentRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Agents"],
  summary: "Get agent",
  description: "Returns a single agent by ID.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "Agent detail",
      content: {
        "application/json": { schema: agentResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(getAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const agent = await getAgentById(orgId, id);

  return c.json(formatAgent(agent), 200);
});

// PATCH /:id
const updateAgentRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Agents"],
  summary: "Update agent",
  description: "Updates agent name or description.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
    body: {
      content: {
        "application/json": { schema: updateAgentSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Agent updated",
      content: {
        "application/json": { schema: agentResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const agent = await updateAgent(orgId, id, body);

  return c.json(formatAgent(agent), 200);
});

// DELETE /:id
const deleteAgentRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Agents"],
  summary: "Delete agent",
  description:
    "Deletes an agent and all its API keys and tool assignments (cascade).",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    204: { description: "Agent deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(deleteAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  await deleteAgent(orgId, id);

  return c.body(null, 204);
});

// POST /:id/activate
router.post(
  "/:id/activate",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);
router.post(
  "/:id/deactivate",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);
router.post(
  "/:id/regenerate-key",
  requireUser(),
  requirePermission("agents:generate-key"),
  requireOrganization(),
);

const activateAgentRoute = createRoute({
  method: "post",
  path: "/{id}/activate",
  tags: ["Agents"],
  summary: "Activate agent",
  description: "Sets the agent's active status to true.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "Agent activated",
      content: {
        "application/json": { schema: agentResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(activateAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const agent = await setAgentActive(orgId, id, true);

  return c.json(formatAgent(agent), 200);
});

// POST /:id/deactivate
const deactivateAgentRoute = createRoute({
  method: "post",
  path: "/{id}/deactivate",
  tags: ["Agents"],
  summary: "Deactivate agent",
  description: "Sets the agent's active status to false.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "Agent deactivated",
      content: {
        "application/json": { schema: agentResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(deactivateAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const agent = await setAgentActive(orgId, id, false);

  return c.json(formatAgent(agent), 200);
});

// POST /:id/regenerate-key
const regenerateKeyRoute = createRoute({
  method: "post",
  path: "/{id}/regenerate-key",
  tags: ["Agents"],
  summary: "Regenerate API key",
  description:
    "Deactivates all existing API keys for the agent and generates a new one. The new key is returned once.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "New API key generated",
      content: {
        "application/json": { schema: regenerateKeyResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(regenerateKeyRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const user = getCurrentUser(c);
  const { id } = c.req.valid("param");
  const result = await regenerateApiKey(orgId, id, user.id);

  return c.json(result, 200);
});

// POST /:id/sync
router.post(
  "/:id/sync",
  requireUser(),
  requirePermission("agents:update"),
  requireOrganization(),
);

const syncAgentRoute = createRoute({
  method: "post",
  path: "/{id}/sync",
  tags: ["Agents"],
  summary: "Sync agent to ElevenLabs",
  description:
    "Pushes MCP server URL and post-call webhook URL to ElevenLabs. Creates workspace webhook and MCP server if needed, stores HMAC secret for signature verification.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "Sync completed",
      content: {
        "application/json": {
          schema: z.object({
            secretId: z.string().nullable(),
            mcpServerId: z.string(),
            webhookId: z.string(),
            syncedAt: z.string(),
            steps: z.array(
              z.object({
                step: z.string(),
                status: z.enum(["success", "skipped", "error"]),
                message: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    400: errorResponse(
      "Invalid input (missing platform, agent ID, or API key)",
    ),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(syncAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const result = await syncAgentToElevenLabs(orgId, id);

  return c.json(result, 200);
});

// PUT /:id/platform-key
router.put(
  "/:id/platform-key",
  requireUser(),
  requirePermission("agents:update"),
  requireOrganization(),
);

const upsertPlatformKeySchema = z.object({
  value: z.string().min(1).openapi({ description: "Platform API key value" }),
});

const upsertPlatformKeyRoute = createRoute({
  method: "put",
  path: "/{id}/platform-key",
  tags: ["Agents"],
  summary: "Upsert platform API key",
  description:
    "Creates or updates the platform API key (e.g. ElevenLabs) for an agent. Stored encrypted.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
    body: {
      content: {
        "application/json": { schema: upsertPlatformKeySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Platform key upserted",
      content: {
        "application/json": {
          schema: z.object({
            action: z.enum(["created", "updated"]),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(upsertPlatformKeyRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const { value } = c.req.valid("json");
  const result = await upsertAgentPlatformKey(orgId, id, value);

  return c.json(result, 200);
});

// GET /:id/connectors
router.get(
  "/:id/connectors",
  requireUser(),
  requirePermission("agents:read"),
  requireOrganization(),
);
router.post(
  "/:id/connectors",
  requireUser(),
  requirePermission("tools:assign"),
  requireOrganization(),
);
router.patch(
  "/:id/connectors/:connectorId",
  requireUser(),
  requirePermission("tools:assign"),
  requireOrganization(),
);
router.delete(
  "/:id/connectors/:connectorId",
  requireUser(),
  requirePermission("tools:unassign"),
  requireOrganization(),
);

const listAgentConnectorsRoute = createRoute({
  method: "get",
  path: "/{id}/connectors",
  tags: ["Agents"],
  summary: "List agent connectors",
  description:
    "Returns all connectors and tools assigned to this agent, grouped by connector.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "Agent connector assignments",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(agentConnectorResponseSchema),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(listAgentConnectorsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const data = await listAgentConnectors(orgId, id);

  return c.json({ data }, 200);
});

// POST /:id/connectors
const assignConnectorToolsRoute = createRoute({
  method: "post",
  path: "/{id}/connectors",
  tags: ["Agents"],
  summary: "Assign connector to agent",
  description:
    "Assigns a connector's tools to an agent with optional settings per tool.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
    body: {
      content: {
        "application/json": { schema: assignConnectorSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Connector assigned",
      content: {
        "application/json": {
          schema: z.object({ assigned: z.number() }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent or connector not found"),
    409: errorResponse("Duplicate assignment"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(assignConnectorToolsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await assignConnectorToAgent(orgId, id, body);

  return c.json(result, 201);
});

// PATCH /:id/connectors/:connectorId
const updateConnectorToolsRoute = createRoute({
  method: "patch",
  path: "/{id}/connectors/{connectorId}",
  tags: ["Agents"],
  summary: "Update agent connector tools",
  description:
    "Updates isEnabled/requiresConfirmation for tools of a specific connector assigned to the agent.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentConnectorParams,
    body: {
      content: {
        "application/json": { schema: updateConnectorToolsSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Tools updated",
      content: {
        "application/json": {
          schema: z.object({ updated: z.number() }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent or tool not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateConnectorToolsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id, connectorId } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await updateAgentConnectorTools(orgId, id, connectorId, body);

  return c.json(result, 200);
});

// DELETE /:id/connectors/:connectorId
const removeConnectorRoute = createRoute({
  method: "delete",
  path: "/{id}/connectors/{connectorId}",
  tags: ["Agents"],
  summary: "Remove connector from agent",
  description: "Removes all tool assignments for a connector from an agent.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentConnectorParams,
  },
  responses: {
    204: { description: "Connector removed from agent" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent or connector not found"),
  },
});

router.openapi(removeConnectorRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id, connectorId } = c.req.valid("param");
  await removeConnectorFromAgent(orgId, id, connectorId);

  return c.body(null, 204);
});

export default router;
