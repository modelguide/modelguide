/**
 * Authentication routes for magic link login with refresh token rotation
 */

import { env } from "@/env";
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import { parseDuration, verifyRefreshJWT } from "@lib/jwt";
import { csrfProtection, getCurrentUser, requireUser } from "@lib/middleware";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requestMagicLink, verifyMagicToken } from "./auth.service";
import { revokeSession, rotateRefreshToken } from "./refresh-token.service";

const router = createRouter();

// ============================================================================
// Cookie helpers
// ============================================================================

const useSecureCookies = new URL(env.APP_URL).protocol === "https:";
const REFRESH_COOKIE = useSecureCookies
  ? "__Host-refresh_token"
  : "refresh_token";

function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string) {
  const maxAge = parseDuration(env.REFRESH_TOKEN_EXPIRES_IN);
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: "Strict",
    path: "/",
    maxAge,
  });
}

function clearRefreshCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, REFRESH_COOKIE, {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: "Strict",
    path: "/",
  });
}

// ============================================================================
// Schemas
// ============================================================================

const loginRequestSchema = z.object({
  email: z.string().email().openapi({
    example: "admin@pizza-palace.com",
    description:
      "User's email address. Seed users: admin@pizza-palace.com, support@pizza-palace.com, admin@burger-barn.com, support@burger-barn.com",
  }),
});

const loginResponseSchema = z.object({
  message: z.string().openapi({
    example: "Magic link sent",
  }),
});

const verifyResponseSchema = z.object({
  token: z.string().openapi({
    description: "Short-lived JWT access token (15 min default)",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  }),
  user: z
    .object({
      id: z.string().uuid().openapi({
        example: "550e8400-e29b-41d4-a716-446655440000",
      }),
      email: z.string().email().openapi({
        example: "admin@pizza-palace.com",
      }),
      name: z.string().openapi({
        example: "Admin User",
      }),
      role: z.enum(["admin", "support"]).openapi({
        example: "admin",
      }),
      organizationId: z.string().uuid().openapi({
        example: "550e8400-e29b-41d4-a716-446655440001",
        description: "Organization ID (Pizza Palace or Burger Barn)",
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
    example: "admin@pizza-palace.com",
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
    description: "Organization ID (Pizza Palace or Burger Barn)",
  }),
});

const errorResponseSchema = z.object({
  code: z.string().openapi({
    example: "UNAUTHORIZED",
    description:
      "Error codes: UNAUTHORIZED, MAGIC_TOKEN_INVALID, MAGIC_TOKEN_EXPIRED, MAGIC_TOKEN_USED, REFRESH_TOKEN_INVALID, REFRESH_TOKEN_EXPIRED, REFRESH_TOKEN_REUSED, CSRF_REJECTED",
  }),
  message: z.string().openapi({
    example: "Authentication required",
  }),
});

// ============================================================================
// Routes
// ============================================================================

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Authentication"],
  summary: "Request magic link login",
  description: `Sends a magic link to the user's email for passwordless authentication.

**Test with seed data:**
- \`admin@pizza-palace.com\` / \`support@pizza-palace.com\` (Pizza Palace org)
- \`admin@burger-barn.com\` / \`support@burger-barn.com\` (Burger Barn org)

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

const verifyRoute = createRoute({
  method: "get",
  path: "/verify",
  tags: ["Authentication"],
  summary: "Verify magic link token",
  description: `Verifies the magic link token and returns a short-lived JWT access token.
A refresh token is also set as an httpOnly cookie for silent token renewal.

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
      description:
        "Token verified, JWT returned. Refresh token set as httpOnly cookie.",
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

  setRefreshCookie(c, result.refreshToken);

  return c.json({ token: result.accessToken, user: result.user }, 200);
});

// ============================================================================
// Refresh token endpoint (CSRF-protected)
// ============================================================================

const refreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  tags: ["Authentication"],
  summary: "Refresh access token",
  description: `Rotates the refresh token and issues a new short-lived access token.
The refresh token is read from the \`${REFRESH_COOKIE}\` httpOnly cookie.
Requires Origin header for CSRF protection.`,
  responses: {
    200: {
      description:
        "New access token issued. New refresh token set as httpOnly cookie.",
      content: {
        "application/json": {
          schema: verifyResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid, expired, or reused refresh token",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "CSRF validation failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.use("/refresh", csrfProtection());
router.openapi(refreshRoute, async (c) => {
  const rawToken = getCookie(c, REFRESH_COOKIE);

  if (!rawToken) {
    return c.json(
      { code: "REFRESH_TOKEN_INVALID", message: "No refresh token" },
      401,
    );
  }

  const result = await rotateRefreshToken(rawToken);

  setRefreshCookie(c, result.refreshToken);

  return c.json({ token: result.accessToken, user: result.user }, 200);
});

// ============================================================================
// Logout (CSRF-protected)
// ============================================================================

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Authentication"],
  summary: "Logout",
  description:
    "Revokes the refresh token session and clears the cookie. Requires generation match to prevent stale-token logout attacks.",
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
    403: {
      description: "CSRF validation failed",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

router.use("/logout", csrfProtection());
router.openapi(logoutRoute, async (c) => {
  const rawToken = getCookie(c, REFRESH_COOKIE);

  if (rawToken) {
    const payload = await verifyRefreshJWT(rawToken);
    if (payload) {
      await revokeSession(payload.familyId);
    }
  }

  clearRefreshCookie(c);

  return c.json({ message: "Logged out successfully" }, 200);
});

// ============================================================================
// Current user
// ============================================================================

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Authentication"],
  summary: "Get current user",
  description: `Returns the currently authenticated user's information.

**Requires:** Bearer JWT token in Authorization header.

**How to get a token:**
1. POST /api/auth/login with \`{"email": "admin@pizza-palace.com"}\`
2. Copy the token from the console magic link URL
3. GET /api/auth/verify?token=YOUR_TOKEN to receive a JWT
4. Use the JWT below as Bearer token`,
  security: [{ bearerAuth: [] }],
  request: {
    headers: z.object({
      authorization: z.string().openapi({
        example: "Bearer <paste JWT from /api/auth/verify>",
        description: "JWT token from the verify endpoint",
      }),
    }),
  },
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

router.use("/me", requireUser());
router.openapi(meRoute, async (c) => {
  const user = getCurrentUser(c);

  return c.json(user, 200);
});

export default router;
