/**
 * Secrets management routes
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getOrganizationId,
  requireOrganization,
  requirePermission,
} from "@lib/middleware";
import {
  paginate,
  paginatedResponseSchema,
  paginationSchema,
} from "@lib/pagination";
import {
  createSecret,
  deleteSecret,
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
  value: z.string().min(1).openapi({
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
    value: z.string().min(1).optional().openapi({
      example: "sk_live_new_xxx...",
    }),
  })
  .refine((data) => data.name !== undefined || data.value !== undefined, {
    message: "At least one of 'name' or 'value' must be provided",
  });

const errorResponseSchema = z.object({
  code: z.string().openapi({ example: "NOT_FOUND" }),
  message: z.string().openapi({ example: "Secret not found" }),
});

// ============================================================================
// Shared response helpers
// ============================================================================

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: errorResponseSchema } },
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

router.get("/", requirePermission("secrets:read"), requireOrganization());
router.post("/", requirePermission("secrets:create"), requireOrganization());

router.openapi(listRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { page, pageSize } = c.req.valid("query");

  const { items, total } = await listSecrets(orgId, { page, pageSize });

  return c.json(paginate(items, page, pageSize, total), 200);
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
    422: errorResponse("Validation error"),
  },
});

router.openapi(createSecretRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const body = c.req.valid("json");

  const secret = await createSecret(orgId, body);

  return c.json(secret, 201);
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
    params: z.object({
      id: z.string().uuid().openapi({
        description: "Secret ID",
        example: "550e8400-e29b-41d4-a716-446655440000",
      }),
    }),
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

router.patch(
  "/:id",
  requirePermission("secrets:update"),
  requireOrganization(),
);
router.delete(
  "/:id",
  requirePermission("secrets:delete"),
  requireOrganization(),
);

router.openapi(updateRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const secret = await updateSecret(orgId, id, body);

  return c.json(secret, 200);
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
    params: z.object({
      id: z.string().uuid().openapi({
        description: "Secret ID",
        example: "550e8400-e29b-41d4-a716-446655440000",
      }),
    }),
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
