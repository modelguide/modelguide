/**
 * Agent management routes
 */

import { env } from "@/env";
import type { Agent } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { getAgentElevenLabsKey } from "@features/secrets";
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import { Errors } from "@lib/errors";
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
  createOutboundCall,
  createVoicePrototypeSession,
  createVoiceTestSession,
  deleteAgent,
  getAgentById,
  listAgentConnectors,
  listAgents,
  pingLivekitConfig,
  regenerateApiKey,
  removeConnectorFromAgent,
  setAgentActive,
  updateAgent,
  updateAgentConnectorTools,
  upsertAgentPlatformKey,
  upsertLivekitConfig,
} from "./agents.service";
import { syncAgentToElevenLabs } from "./agents.sync";
import {
  getElevenLabsExternalId,
  setElevenLabsExternalId,
} from "./elevenlabs-metadata";
import {
  type ModelFamily,
  getElevenLabsModelGroups,
} from "./elevenlabs-models";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

// Matches the multi-SOP provenance shape persisted by compiler.service.ts
// (see `compiledFrom` assembly near end of compileAgent). Kept in sync with
// modelguide-ui/src/schemas/agents.ts:compiledFromSchema.
const compiledFromSchema = z
  .object({
    sops: z.array(
      z.object({
        sopId: z.string().uuid(),
        sopName: z.string(),
        stepCount: z.number().int().nonnegative(),
      }),
    ),
    guardrailIds: z.array(z.string().uuid()),
    toolCount: z.number().int().nonnegative(),
  })
  .nullable();

const promptConfigSchema = z
  .object({
    persona: z.string().max(5000).optional(),
    fillerPhrases: z.array(z.string().max(200)).max(20).optional(),
    language: z.string().max(100).optional(),
  })
  .strict();

const modelFamilySchema = z.enum(["gpt", "claude", "gemini", "generic"]);

const agentResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  modality: z.enum(["voice", "text"]),
  modelFamily: modelFamilySchema,
  promptConfig: promptConfigSchema,
  agentPlatform: z.enum(["custom", "elevenlabs", "livekit"]),
  isActive: z.boolean(),
  evalSuiteCount: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).optional(),
  secrets: z.record(z.string()).openapi({
    description:
      "Secret ref map: { fieldName: secretId }. No decrypted values.",
  }),
  hasElevenLabsKey: z.boolean(),
  hasWebhookSecret: z.boolean(),
  keyPrefix: z.string().nullable(),
  integrationUrls: z
    .object({
      sessionInit: z.string(),
      mcp: z.string(),
      postCallWebhook: z.string(),
      conversationInitWebhook: z.string(),
    })
    .optional(),
  compiledInstructions: z.string().nullable(),
  compiledAt: z.string().nullable(),
  compiledFrom: compiledFromSchema,
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
  modality: z.enum(["voice", "text"]).default("voice"),
  modelFamily: modelFamilySchema.default("generic"),
  promptConfig: promptConfigSchema.optional(),
  agentPlatform: z.enum(["custom", "elevenlabs", "livekit"]).default("custom"),
  metadata: z.record(z.unknown()).optional(),
  secrets: z.record(z.string().uuid()).optional().openapi({
    description: "Secret ref map: { fieldName: secretId }",
  }),
});

const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    modelFamily: modelFamilySchema.optional(),
    promptConfig: promptConfigSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    agentPlatform: z.enum(["custom", "elevenlabs", "livekit"]).optional(),
    secrets: z.record(z.string().uuid()).optional().openapi({
      description: "Secret ref map: { fieldName: secretId }",
    }),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.modelFamily !== undefined ||
      data.promptConfig !== undefined ||
      data.metadata !== undefined ||
      data.agentPlatform !== undefined ||
      data.secrets !== undefined,
    {
      message: "At least one field must be provided",
    },
  );

const assignConnectorSchema = z.object({
  connectorId: z.string().uuid().openapi({ description: "Connector ID" }),
  tools: z.array(
    z.object({
      slug: z.string().openapi({ description: "Tool slug" }),
      isEnabled: z.boolean().default(true),
      requiresConfirmation: z.boolean().default(false),
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
    .enum(["custom", "elevenlabs", "livekit"])
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
    evalSuiteCount?: number;
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
    modelFamily: agent.modelFamily,
    promptConfig: (agent.promptConfig ?? {}) as Record<string, unknown>,
    agentPlatform: agent.agentPlatform,
    isActive: agent.isActive,
    evalSuiteCount: agent.evalSuiteCount ?? 0,
    metadata,
    secrets: (agent.secrets ?? {}) as Record<string, string>,
    hasElevenLabsKey: agent.hasElevenLabsKey ?? false,
    hasWebhookSecret: agent.hasWebhookSecret ?? false,
    keyPrefix: agent.keyPrefix ?? null,
    integrationUrls: {
      sessionInit: `${externalBase}/api/sessions`,
      mcp: `${externalBase}/mcp/${agent.id}`,
      postCallWebhook: `${externalBase}/webhooks/elevenlabs/${agent.id}/post-call`,
      conversationInitWebhook: `${externalBase}/webhooks/elevenlabs/${agent.id}/conversation-init`,
    },
    compiledInstructions: agent.compiledInstructions ?? null,
    compiledAt: agent.compiledAt?.toISOString() ?? null,
    compiledFrom: (() => {
      const parsed = compiledFromSchema.safeParse(agent.compiledFrom ?? null);
      return parsed.success ? parsed.data : null;
    })(),
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

// ============================================================================
// Platform Models Endpoint
// ============================================================================

// GET /platform-models
router.get(
  "/platform-models",
  requireUser(),
  requirePermission("agents:read"),
  requireOrganization(),
);

const platformModelsQuerySchema = z.object({
  platform: z
    .enum(["elevenlabs"])
    .openapi({ description: "Agent platform to list LLM models for" }),
  family: z
    .enum(["gpt", "claude", "gemini", "generic"])
    .optional()
    .openapi({ description: "Filter models by family" }),
});

const platformModelsRoute = createRoute({
  method: "get",
  path: "/platform-models",
  tags: ["Agents"],
  summary: "List LLM models for a platform",
  description:
    "Returns a curated list of LLM models for the given agent platform, grouped by family. Filter by ?family=gpt|claude|gemini|generic.",
  security: [{ bearerAuth: [] }],
  request: {
    query: platformModelsQuerySchema,
  },
  responses: {
    200: {
      description: "Curated model list grouped by family",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(
              z.object({
                family: z.string(),
                models: z.array(
                  z.object({
                    id: z.string(),
                    label: z.string(),
                  }),
                ),
              }),
            ),
          }),
        },
      },
    },
    400: errorResponse("Unsupported platform"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(platformModelsRoute, async (c) => {
  const { platform, family } = c.req.valid("query");

  // Branch per platform — extend here when new platforms are added
  if (platform === "elevenlabs") {
    const data = getElevenLabsModelGroups(family as ModelFamily | undefined);
    return c.json({ data }, 200);
  }

  throw Errors.invalidInput(`Unsupported platform: ${platform}`);
});

// ============================================================================
// Platform Agent Creation
// ============================================================================

// POST /:id/platform-agent
router.post(
  "/:id/platform-agent",
  requireUser(),
  requirePermission("agents:update"),
  requireOrganization(),
);

const createPlatformAgentRoute = createRoute({
  method: "post",
  path: "/{id}/platform-agent",
  tags: ["Agents"],
  summary: "Create agent on a platform",
  description:
    "Creates a minimal shell agent on the given platform using the agent name. Returns the platform-assigned agent ID and saves it to metadata.<platform>.externalId (with metadata.<platform>.agentId preserved as a legacy alias). All real configuration is applied via sync. Pass { force: true } in the request body to replace an existing platform ID atomically.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            platform: z.enum(["elevenlabs"]).openapi({
              description: "Target platform to create the agent on",
            }),
            force: z.boolean().optional().openapi({
              description:
                "Clear any existing agentId and create a new agent atomically. Without this flag the endpoint returns 409 if an agentId is already set.",
            }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Platform agent created",
      content: {
        "application/json": {
          schema: z.object({
            platformAgentId: z.string(),
          }),
        },
      },
    },
    400: errorResponse(
      "Platform API key not configured or unsupported platform",
    ),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
    409: errorResponse("Platform agent already exists for this agent"),
  },
});

router.openapi(createPlatformAgentRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const { platform, force } = c.req.valid("json");

  const agent = await getAgentById(orgId, id);

  const meta = (agent.metadata ?? {}) as Record<string, unknown>;

  // Branch per platform — extend here when new platforms are added
  if (platform === "elevenlabs") {
    const elMeta = (meta.elevenlabs ?? {}) as Record<string, unknown>;
    const savedExternalId = getElevenLabsExternalId(elMeta);

    // Guard: agent ID already set — 409 unless force=true
    if (savedExternalId && !force) {
      throw Errors.conflict(
        "ElevenLabs agent ID already set — pass force: true to replace it",
      );
    }

    if (!agent.hasElevenLabsKey) {
      throw Errors.invalidInput(
        "ElevenLabs API key must be configured before creating an agent",
      );
    }

    const apiKey = await getAgentElevenLabsKey(orgId, id);
    if (!apiKey) {
      throw Errors.invalidInput(
        "ElevenLabs API key not configured for this agent",
      );
    }

    const client = new ElevenLabsClient({ apiKey });
    const created = await client.conversationalAi.agents.create({
      name: agent.name,
      conversationConfig: {},
    });

    const platformAgentId = created.agentId;

    // Persist the remote platform ID to metadata.
    // When force=true, also clear sync-derived fields that are bound to the
    // old remote agent (webhook, MCP server, last sync state) so the UI does
    // not show stale "already synced" indicators for the new agent.
    const {
      agentId: _old,
      externalId: _externalId,
      lastSyncedAt: _syncedAt,
      agentName: _agentName,
      webhookId: _webhookId,
      mcpServerId: _mcpServerId,
      ...elMetaCore
    } = elMeta;
    await updateAgent(orgId, id, {
      metadata: {
        ...meta,
        elevenlabs: setElevenLabsExternalId(elMetaCore, platformAgentId),
      },
    });

    return c.json({ platformAgentId }, 201);
  }

  throw Errors.invalidInput(`Unsupported platform: ${platform}`);
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
  await updateAgent(orgId, id, body);
  const agent = await getAgentById(orgId, id);

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

// ============================================================================
// LiveKit Config
// ============================================================================

router.put(
  "/:id/livekit-config",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);

const upsertLivekitConfigSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("wss://") || u.startsWith("https://"), {
      message: "URL must use wss:// or https://",
    })
    .openapi({ description: "LiveKit Cloud WebSocket URL" }),
  apiKeySecretId: z
    .string()
    .uuid()
    .openapi({ description: "Secret ID referencing the LiveKit API Key" }),
  apiSecretSecretId: z
    .string()
    .uuid()
    .openapi({ description: "Secret ID referencing the LiveKit API Secret" }),
  agentName: z
    .string()
    .min(1)
    .openapi({ description: "Agent name registered in LiveKit" }),
});

const upsertLivekitConfigRoute = createRoute({
  method: "put",
  path: "/{id}/livekit-config",
  tags: ["Agents"],
  summary: "Upsert LiveKit config",
  description:
    "Creates or updates the LiveKit config for an agent. References existing secrets by ID.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
    body: {
      content: {
        "application/json": { schema: upsertLivekitConfigSchema },
      },
    },
  },
  responses: {
    200: {
      description: "LiveKit config upserted",
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

router.openapi(upsertLivekitConfigRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await upsertLivekitConfig(orgId, id, body);

  return c.json(result, 200);
});

// ============================================================================
// LiveKit Ping
// ============================================================================

router.post(
  "/:id/livekit-ping",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);

const livekitPingRoute = createRoute({
  method: "post",
  path: "/{id}/livekit-ping",
  tags: ["Agents"],
  summary: "Test LiveKit connection",
  description:
    "Tests the LiveKit connection by attempting to list rooms with the configured credentials.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    200: {
      description: "Connection successful",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean() }),
        },
      },
    },
    400: errorResponse("LiveKit not configured"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(livekitPingRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const result = await pingLivekitConfig(orgId, id);

  return c.json(result, 200);
});

// ============================================================================
// Outbound Calls
// ============================================================================

router.post(
  "/:id/outbound-call",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);

const outboundCallSchema = z.object({
  phoneNumber: z.string().min(1).openapi({ example: "+14155551234" }),
  email: z
    .string()
    .email()
    .optional()
    .openapi({ example: "customer@example.com" }),
  name: z.string().optional().openapi({ example: "John Doe" }),
});

const outboundCallRoute = createRoute({
  method: "post",
  path: "/{id}/outbound-call",
  tags: ["Agents"],
  summary: "Initiate outbound call",
  description:
    "Dispatches the agent to dial an outbound call via SIP trunk. Creates a session and returns its ID.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
    body: {
      content: {
        "application/json": { schema: outboundCallSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Call dispatched",
      content: {
        "application/json": {
          schema: z.object({
            sessionId: z.string().uuid(),
            roomName: z.string(),
            dispatchId: z.string(),
          }),
        },
      },
    },
    400: errorResponse("Agent not active or not a voice agent"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(outboundCallRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const result = await createOutboundCall(orgId, id, body);

  return c.json(result, 201);
});

// ============================================================================
// Voice Test (browser WebRTC)
// ============================================================================

router.post(
  "/:id/voice-test-token",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);

const voiceTestTokenResponseSchema = z.object({
  livekitUrl: z.string(),
  roomName: z.string(),
  token: z.string(),
  sessionId: z.string().uuid(),
  dispatchId: z.string(),
  agentName: z.string(),
  profileName: z.string(),
  identity: z.string(),
});

const voiceTestTokenRoute = createRoute({
  method: "post",
  path: "/{id}/voice-test-token",
  tags: ["Agents"],
  summary: "Issue a LiveKit voice-test token",
  description:
    "Creates a ModelGuide session, dispatches the configured LiveKit worker into a fresh room with the agent's slug as `agentName` in metadata (so a multi-profile worker picks the correct profile), and returns a short-lived LiveKit AccessToken so the browser can join via WebRTC and talk to the agent.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    201: {
      description: "Voice test session created",
      content: {
        "application/json": { schema: voiceTestTokenResponseSchema },
      },
    },
    400: errorResponse(
      "LiveKit not configured, missing credentials, or wrong modality",
    ),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(voiceTestTokenRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const user = getCurrentUser(c);
  const { id } = c.req.valid("param");

  const result = await createVoiceTestSession(orgId, id, {
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  return c.json(result, 201);
});

// ============================================================================
// Voice Prototype (browser WebRTC + compiled prompt injected via metadata)
// ============================================================================

router.post(
  "/:id/voice-prototype-token",
  requireUser(),
  requirePermission("agents:activate"),
  requireOrganization(),
);

const voicePrototypeTokenResponseSchema = z.object({
  livekitUrl: z.string(),
  roomName: z.string(),
  token: z.string(),
  sessionId: z.string().uuid(),
  dispatchId: z.string(),
  agentName: z.string(),
  identity: z.string(),
  promptChars: z.number().int().nonnegative(),
});

const voicePrototypeTokenRoute = createRoute({
  method: "post",
  path: "/{id}/voice-prototype-token",
  tags: ["Agents"],
  summary: "Issue a LiveKit voice-prototype token",
  description:
    "Like /voice-test-token, but dispatches the prompt-driven prototype worker with the agent's compiled instructions injected into dispatch metadata. Lets an admin compile a prompt and immediately hear how it sounds without redeploying a worker profile. See ADR-015 for why this is a separate code path from the production voice-test flow.",
  security: [{ bearerAuth: [] }],
  request: {
    params: agentIdParams,
  },
  responses: {
    201: {
      description: "Voice prototype session created",
      content: {
        "application/json": { schema: voicePrototypeTokenResponseSchema },
      },
    },
    400: errorResponse(
      "LiveKit not configured, agent not active, modality wrong, or no compiled prompt",
    ),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent not found"),
  },
});

router.openapi(voicePrototypeTokenRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const user = getCurrentUser(c);
  const { id } = c.req.valid("param");

  const result = await createVoicePrototypeSession(orgId, id, {
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  return c.json(result, 201);
});

export default router;
