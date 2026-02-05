/**
 * Authentication routes for magic link login
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import { getCurrentUser, requireUser } from "@lib/middleware";
import { requestMagicLink, verifyMagicToken } from "./auth.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const loginRequestSchema = z.object({
  email: z.string().email().openapi({
    example: "admin@test-org.com",
    description:
      "User's email address. Seed users: admin@test-org.com (admin role), support@test-org.com (support role)",
  }),
});

const loginResponseSchema = z.object({
  message: z.string().openapi({
    example: "Magic link sent",
  }),
});

const verifyResponseSchema = z.object({
  token: z.string().openapi({
    description: "JWT token for authentication",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  }),
  user: z
    .object({
      id: z.string().uuid().openapi({
        example: "550e8400-e29b-41d4-a716-446655440000",
      }),
      email: z.string().email().openapi({
        example: "admin@test-org.com",
      }),
      name: z.string().openapi({
        example: "Admin User",
      }),
      role: z.enum(["admin", "support"]).openapi({
        example: "admin",
      }),
      organizationId: z.string().uuid().openapi({
        example: "550e8400-e29b-41d4-a716-446655440001",
      }),
    })
    .openapi({
      description: "Authenticated user information",
    }),
});

const meResponseSchema = z.object({
  id: z.string().uuid().openapi({
    example: "550e8400-e29b-41d4-a716-446655440000",
  }),
  email: z.string().email().openapi({
    example: "admin@test-org.com",
  }),
  name: z.string().openapi({
    example: "Admin User",
  }),
  role: z.enum(["admin", "support"]).openapi({
    example: "admin",
    description: "User role: admin has full access, support has limited access",
  }),
  organizationId: z.string().uuid().openapi({
    example: "550e8400-e29b-41d4-a716-446655440001",
    description: "Organization ID the user belongs to (Test Organization)",
  }),
});

const errorResponseSchema = z.object({
  code: z.string().openapi({
    example: "UNAUTHORIZED",
    description:
      "Error codes: UNAUTHORIZED, MAGIC_TOKEN_INVALID, MAGIC_TOKEN_EXPIRED, MAGIC_TOKEN_USED",
  }),
  message: z.string().openapi({
    example: "Authentication required",
  }),
});

// ============================================================================
// Routes
// ============================================================================

// POST /api/auth/login - Request magic link
const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Authentication"],
  summary: "Request magic link login",
  description: `Sends a magic link to the user's email for passwordless authentication.

**Test with seed data:**
- \`admin@test-org.com\` - Admin user with full permissions
- \`support@test-org.com\` - Support user with limited permissions

In development mode, the magic link is printed to the console instead of being sent via email.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: loginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Magic link sent (or user not found - same response for security)",
      content: {
        "application/json": {
          schema: loginResponseSchema,
        },
      },
    },
    422: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.openapi(loginRoute, async (c) => {
  const { email } = c.req.valid("json");

  await requestMagicLink(email);

  return c.json({ message: "Magic link sent" }, 200);
});

// GET /api/auth/verify - Verify magic link token
const verifyRoute = createRoute({
  method: "get",
  path: "/verify",
  tags: ["Authentication"],
  summary: "Verify magic link token",
  description: `Verifies the magic link token and returns a JWT for authentication.

**Testing flow:**
1. Call POST /api/auth/login with a seed user email
2. Copy the token from the console output (the magic link URL contains the token)
3. Call this endpoint with the token to get a JWT
4. Use the JWT in the Authorization header for authenticated endpoints`,
  request: {
    query: z.object({
      token: z.string().min(1).openapi({
        description:
          "Magic link token from email/console. Get this from the magic link URL after calling /login",
        example: "abc123xyz...",
      }),
    }),
  },
  responses: {
    200: {
      description: "Token verified, JWT returned",
      content: {
        "application/json": {
          schema: verifyResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid, expired, or already used token",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.openapi(verifyRoute, async (c) => {
  const { token } = c.req.valid("query");

  const result = await verifyMagicToken(token);

  return c.json(result, 200);
});

// POST /api/auth/logout - Logout (optional, JWT is stateless)
const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Authentication"],
  summary: "Logout",
  description:
    "Logout endpoint. Since JWTs are stateless, this is mainly for client-side cleanup",
  responses: {
    200: {
      description: "Logged out successfully",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
          }),
        },
      },
    },
  },
});

router.openapi(logoutRoute, async (c) => {
  // JWT is stateless, so logout is handled client-side
  // This endpoint exists for completeness and potential future token blacklisting
  return c.json({ message: "Logged out successfully" }, 200);
});

// GET /api/auth/me - Get current user
const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Authentication"],
  summary: "Get current user",
  description: `Returns the currently authenticated user's information.

**Requires:** Bearer JWT token in Authorization header.

**Example:** \`Authorization: Bearer eyJhbGciOiJIUzI1NiIs...\``,
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current user information",
      content: {
        "application/json": {
          schema: meResponseSchema,
        },
      },
    },
    401: {
      description: "Not authenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

// Apply middleware and handler separately
router.use("/me", requireUser());
router.openapi(meRoute, async (c) => {
  const user = getCurrentUser(c);

  return c.json(user, 200);
});

export default router;
