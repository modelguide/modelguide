import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import { Errors } from "@lib/errors";
import {
  getCurrentUser,
  getOrganizationId,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { paginatedResponseSchema, paginationSchema } from "@lib/pagination";
import {
  createUser,
  deactivateUser,
  getUserById,
  listUsers,
  updateUser,
} from "./users.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(["admin", "support"]),
  organizationId: z.string().uuid(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(["admin", "support"]).default("support"),
});

const updateUserSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    role: z.enum(["admin", "support"]).optional(),
  })
  .refine((data) => data.name !== undefined || data.role !== undefined, {
    message: "At least one field must be provided",
  });

const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
});

function formatUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as "admin" | "support",
    organizationId: user.organizationId,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

// ============================================================================
// GET /users - List users
// ============================================================================

const listUsersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],
  summary: "List users",
  security: [{ bearerAuth: [] }],
  request: {
    query: paginationSchema,
  },
  responses: {
    200: {
      description: "Paginated list of users",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(userResponseSchema),
        },
      },
    },
  },
});

router.use("/", requireUser(), requirePermission("users:read"));
router.openapi(listUsersRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");

  const result = await listUsers(orgId, query);

  return c.json(
    {
      data: result.data.map(formatUser),
      pagination: result.pagination,
    },
    200,
  );
});

// ============================================================================
// POST /users - Create user
// ============================================================================

const createUserRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  summary: "Create user",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createUserSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "User created",
      content: {
        "application/json": {
          schema: userResponseSchema,
        },
      },
    },
    409: {
      description: "User email already exists",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.openapi(createUserRoute, async (c) => {
  const currentUser = getCurrentUser(c);
  if (currentUser.role !== "admin") {
    throw Errors.forbidden(
      "Permission denied: users:create requires admin role",
    );
  }

  const orgId = getOrganizationId(c);
  const data = c.req.valid("json");

  const user = await createUser(orgId, data);

  return c.json(formatUser(user), 201);
});

// ============================================================================
// GET /users/:id - Get user
// ============================================================================

const getUserRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Users"],
  summary: "Get user detail",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "User detail",
      content: {
        "application/json": {
          schema: userResponseSchema,
        },
      },
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.use("/:id", requireUser(), requirePermission("users:read"));
router.openapi(getUserRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");

  const user = await getUserById(orgId, id);

  return c.json(formatUser(user), 200);
});

// ============================================================================
// PATCH /users/:id - Update user
// ============================================================================

const updateUserRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Users"],
  summary: "Update user",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: updateUserSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "User updated",
      content: {
        "application/json": {
          schema: userResponseSchema,
        },
      },
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.openapi(updateUserRoute, async (c) => {
  const currentUser = getCurrentUser(c);
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");

  const isAdmin = currentUser.role === "admin";

  if (!isAdmin && currentUser.id !== id) {
    throw Errors.forbidden(
      "Permission denied: users:update requires admin role",
    );
  }

  // Non-admin users cannot change roles
  if (!isAdmin && data.role) {
    throw Errors.forbidden("Only admins can change user roles");
  }

  // Prevent admin self-demotion (could lock out the org)
  if (
    isAdmin &&
    currentUser.id === id &&
    data.role &&
    data.role !== currentUser.role
  ) {
    throw Errors.forbidden("Cannot change your own role");
  }

  const updateData = isAdmin ? data : { name: data.name };
  const user = await updateUser(orgId, id, updateData);
  return c.json(formatUser(user), 200);
});

// ============================================================================
// DELETE /users/:id - Deactivate user
// ============================================================================

const deleteUserRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Users"],
  summary: "Deactivate user",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    204: {
      description: "User deactivated",
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.openapi(deleteUserRoute, async (c) => {
  const currentUser = getCurrentUser(c);
  if (currentUser.role !== "admin") {
    throw Errors.forbidden(
      "Permission denied: users:delete requires admin role",
    );
  }

  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");

  if (id === currentUser.id) {
    throw Errors.forbidden("Cannot deactivate your own account");
  }

  await deactivateUser(orgId, id);

  return c.body(null, 204);
});

export default router;
