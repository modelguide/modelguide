/**
 * Authentication middleware
 * Handles JWT and API key authentication
 */

import type { AppBindings, AuthAgent, AuthContext } from "@/types";
import { db } from "@db/client";
import { agents, apiKeys } from "@db/schema";
import { hashApiKey, isValidApiKeyFormat } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { verifyJWT } from "@lib/jwt";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

const AUTHORIZATION_HEADER = "Authorization";

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Check if a token is an API key (starts with mgk_)
 */
function isApiKey(token: string): boolean {
  return token.startsWith("mgk_");
}

/**
 * Verify an API key and return the agent context
 */
async function verifyApiKey(key: string): Promise<AuthAgent | null> {
  if (!isValidApiKeyFormat(key)) {
    return null;
  }

  const keyHash = hashApiKey(key);

  const result = await db
    .select({
      apiKey: apiKeys,
      agent: agents,
    })
    .from(apiKeys)
    .leftJoin(agents, eq(apiKeys.agentId, agents.id))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const { apiKey, agent } = result[0];

  if (!apiKey.isActive) {
    return null;
  }

  if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
    return null;
  }

  // If API key is scoped to an agent, the agent must exist and be active
  if (apiKey.agentId && (!agent || !agent.isActive)) {
    return null;
  }

  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id))
    .execute()
    .catch((err) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Failed to update API key lastUsedAt:", err.message);
      }
    });

  if (agent) {
    return {
      id: agent.id,
      name: agent.name,
      organizationId: agent.organizationId,
      agentType: agent.agentType,
      isActive: agent.isActive,
    };
  }

  return null;
}

/**
 * Main authentication middleware
 * Parses Authorization header and sets auth context
 */
export function authMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const authHeader = c.req.header(AUTHORIZATION_HEADER);

    let authContext: AuthContext = { type: "none" };
    let organizationId: string | null = null;

    const token = extractBearerToken(authHeader);

    if (token) {
      if (isApiKey(token)) {
        const agent = await verifyApiKey(token);
        if (agent) {
          authContext = { type: "agent", agent };
          organizationId = agent.organizationId;
        }
      } else {
        const user = await verifyJWT(token);
        if (user) {
          authContext = { type: "user", user };
          organizationId = user.organizationId;
        }
      }
    }

    c.set("auth", authContext);
    c.set("organizationId", organizationId);

    await next();
  };
}

/**
 * Middleware that requires any form of authentication
 */
export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    if (auth.type === "none") {
      throw Errors.unauthorized();
    }

    await next();
  };
}

/**
 * Middleware that requires JWT authentication (user)
 */
export function requireUser(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    if (auth.type !== "user") {
      throw Errors.unauthorized("User authentication required");
    }

    await next();
  };
}

/**
 * Middleware that requires API key authentication (agent)
 * Also validates that the agent is active
 */
export function requireAgent(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const auth = c.get("auth");

    if (auth.type !== "agent") {
      throw Errors.unauthorized("Agent authentication required");
    }

    if (!auth.agent.isActive) {
      throw Errors.agentInactive(auth.agent.id);
    }

    await next();
  };
}

/**
 * Middleware that requires organization header or auth-derived org
 */
export function requireOrganization(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const organizationId = c.get("organizationId");

    if (!organizationId) {
      throw Errors.organizationRequired();
    }

    await next();
  };
}

/**
 * Helper to get current user from context (throws if not authenticated as user)
 */
export function getCurrentUser(c: Context<AppBindings>) {
  const auth = c.get("auth");
  if (auth.type !== "user") {
    throw Errors.unauthorized("User authentication required");
  }
  return auth.user;
}

/**
 * Helper to get current agent from context (throws if not authenticated as agent)
 */
export function getCurrentAgent(c: Context<AppBindings>) {
  const auth = c.get("auth");
  if (auth.type !== "agent") {
    throw Errors.unauthorized("Agent authentication required");
  }
  return auth.agent;
}

/**
 * Helper to get current organization ID (throws if not set)
 */
export function getOrganizationId(c: Context<AppBindings>): string {
  const orgId = c.get("organizationId");
  if (!orgId) {
    throw Errors.organizationRequired();
  }
  return orgId;
}
