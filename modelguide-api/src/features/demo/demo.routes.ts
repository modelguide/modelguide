/**
 * Demo mode routes.
 * Conditionally mounted in app.ts when DEMO_MODE_ENABLED=true.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { setRefreshCookie } from "@lib/cookies";
import { createRouter } from "@lib/create-app";
import { demoLogin } from "./demo.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const demoLoginRequestSchema = z.object({
  email: z.string().email().openapi({
    example: "prospect@example.com",
    description: "Visitor email (used for MX validation)",
  }),
});

const demoLoginResponseSchema = z.object({
  token: z.string().openapi({
    description: "Short-lived JWT access token",
  }),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(["admin", "support", "viewer"]),
    organizationId: z.string().uuid(),
  }),
});

// ============================================================================
// POST /auth/demo-login
// ============================================================================

const demoLoginRoute = createRoute({
  method: "post",
  path: "/auth/demo-login",
  tags: ["Authentication"],
  summary: "Demo login",
  description: "Instantly authenticates a visitor as a read-only demo user.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: demoLoginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Demo login successful",
      content: {
        "application/json": {
          schema: demoLoginResponseSchema,
        },
      },
    },
    404: {
      description: "Demo mode not enabled",
    },
  },
});

router.openapi(demoLoginRoute, async (c) => {
  const { email } = c.req.valid("json");

  const result = await demoLogin(email);

  setRefreshCookie(c, result.refreshToken);

  return c.json(
    {
      token: result.accessToken,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        organizationId: result.user.organizationId,
      },
    },
    200,
  );
});

export default router;
