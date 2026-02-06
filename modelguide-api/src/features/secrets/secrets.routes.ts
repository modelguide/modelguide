/**
 * Secrets management routes
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
import { errorResponseSchema } from "@lib/schemas";
import {
  createSecret,
  deleteSecret,
  getSecretById,
  listSecrets,
  updateSecret,
} from "./secrets.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const secretResponseSchema = z.object({
  id: z.string().uuid().openapi({
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
  name: z.string().openapi({
    example: "Medusa API Key",
  }),
  secretType: z.enum(["api_key", "oauth_token", "credentials"]).openapi({
    example: "api_key",
  }),
  ownerType: z.enum(["connector"]).openapi({
    example: "connector",
  }),
  ownerId: z.string().uuid().openapi({
    example: "550e8400-e29b-41d4-a716-446655440001",
  }),
  createdAt: z.string().openapi({
    example: "2024-01-01T00:00:00.000Z",
  }),
  updatedAt: z.string().nullable().openapi({
    example: "2024-01-01T00:00:00.000Z",
  }),
});

const createSecretRequestSchema = z.object({
  name: z.string().min(1).max(255).openapi({
    example: "Medusa API Key",
    description: "Human-readable name for the secret",
  }),
  value: z.string().min(1).max(10000).openapi({
    example: "sk_live_xxx...",
    description: "The secret value to encrypt and store",
  }),
  secretType: z.enum(["api_key", "oauth_token", "credentials"]).openapi({
    example: "api_key",
  }),
  ownerType: z.enum(["connector"]).openapi({
    example: "connector",
  }),
  ownerId: z.string().uuid().openapi({
    example: "550e8400-e29b-41d4-a716-446655440001",
  }),
});

const updateSecretRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional().openapi({
      example: "Updated Secret Name",
    }),
    value: z.string().min(1).max(10000).optional().openapi({
      example: "sk_live_new_xxx...",
    }),
  })
  .refine((data) => data.name !== undefined || data.value !== undefined, {
    message: "At least one of 'name' or 'value' must be provided",
  });

const secretIdParams = z.object({
  id: z.string().uuid().openapi({
    description: "Secret ID",
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
});

// ============================================================================
// Shared helpers
// ============================================================================

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: errorResponseSchema } },
  };
}

function formatSecret(secret: {
  id: string;
  name: string;
  secretType: string;
  ownerType: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  return {
    id: secret.id,
    name: secret.name,
    secretType: secret.secretType as "api_key" | "oauth_token" | "credentials",
    ownerType: secret.ownerType as "connector",
    ownerId: secret.ownerId,
    createdAt: secret.createdAt.toISOString(),
    updatedAt: secret.updatedAt?.toISOString() ?? null,
  };
}

// ============================================================================
// Routes
// ============================================================================

// GET /
const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Secrets"],
  summary: "List secrets",
  description:
    "Returns paginated list of secrets metadata. Secret values are never returned.",
  security: [{ bearerAuth: [] }],
  request: {
    query: paginationSchema,
  },
  responses: {
    200: {
      description: "Paginated list of secrets",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(secretResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.get(
  "/",
  requireUser(),
  requirePermission("secrets:read"),
  requireOrganization(),
);
router.post(
  "/",
  requireUser(),
  requirePermission("secrets:create"),
  requireOrganization(),
);

router.openapi(listRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");

  const result = await listSecrets(orgId, query);

  return c.json(
    {
      data: result.data.map(formatSecret),
      pagination: result.pagination,
    },
    200,
  );
});

// POST /
const createSecretRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Secrets"],
  summary: "Create secret",
  description:
    "Creates a new encrypted secret. The value is encrypted before storage and never returned in responses.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createSecretRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Secret created",
      content: {
        "application/json": { schema: secretResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Referenced owner not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createSecretRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");

  const secret = await createSecret(orgId, body);

  return c.json(formatSecret(secret), 201);
});

// GET /:id
const getSecretRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Secrets"],
  summary: "Get secret",
  description:
    "Returns secret metadata by ID. The secret value is never returned.",
  security: [{ bearerAuth: [] }],
  request: {
    params: secretIdParams,
  },
  responses: {
    200: {
      description: "Secret detail",
      content: {
        "application/json": { schema: secretResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Secret not found"),
  },
});

router.get(
  "/:id",
  requireUser(),
  requirePermission("secrets:read"),
  requireOrganization(),
);
router.patch(
  "/:id",
  requireUser(),
  requirePermission("secrets:update"),
  requireOrganization(),
);
router.delete(
  "/:id",
  requireUser(),
  requirePermission("secrets:delete"),
  requireOrganization(),
);

router.openapi(getSecretRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");

  const secret = await getSecretById(orgId, id);

  return c.json(formatSecret(secret), 200);
});

// PATCH /:id
const updateRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Secrets"],
  summary: "Update secret",
  description: "Updates a secret's name and/or re-encrypts a new value.",
  security: [{ bearerAuth: [] }],
  request: {
    params: secretIdParams,
    body: {
      content: {
        "application/json": { schema: updateSecretRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Secret updated",
      content: {
        "application/json": { schema: secretResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Secret not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const secret = await updateSecret(orgId, id, body);

  return c.json(formatSecret(secret), 200);
});

// DELETE /:id
const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Secrets"],
  summary: "Delete secret",
  description: "Permanently deletes a secret.",
  security: [{ bearerAuth: [] }],
  request: {
    params: secretIdParams,
  },
  responses: {
    204: { description: "Secret deleted" },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Secret not found"),
  },
});

router.openapi(deleteRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");

  await deleteSecret(orgId, id);

  return c.body(null, 204);
});

export default router;
