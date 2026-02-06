import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import { Errors } from "@lib/errors";
import {
  getOrganizationId,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { getOrganizationById } from "./organizations.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const organizationResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  settings: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
});

function formatOrganization(org: {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    settings: org.settings,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt?.toISOString() ?? null,
  };
}

// ============================================================================
// Routes
// ============================================================================

const getOrganizationRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Organizations"],
  summary: "Get organization details",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Organization details",
      content: {
        "application/json": {
          schema: organizationResponseSchema,
        },
      },
    },
    404: {
      description: "Organization not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.use("/:id", requireUser(), requirePermission("organization:read"));
router.openapi(getOrganizationRoute, async (c) => {
  const { id } = c.req.valid("param");
  const orgId = getOrganizationId(c);

  if (id !== orgId) {
    throw Errors.organizationNotFound(id);
  }

  const org = await getOrganizationById(orgId);

  return c.json(formatOrganization(org), 200);
});

export default router;
