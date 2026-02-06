/**
 * Row-Level Security (RLS) middleware
 *
 * Uses a Drizzle proxy that wraps every query in a short-lived transaction
 * with SET LOCAL config. This is safe with connection pooling because the
 * config and query always execute on the same connection.
 */

import type { AppBindings } from "@/types";
import { db } from "@db/client";
import { createRLSDrizzle } from "@db/rls-proxy";
import type { MiddlewareHandler } from "hono";

const rls = createRLSDrizzle(db);

/**
 * Middleware that sets RLS-scoped db on the Hono context.
 * Must run after authMiddleware which sets organizationId.
 */
export function rlsMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const organizationId = c.get("organizationId");

    if (organizationId) {
      c.set("db", rls.attach(organizationId));
    } else {
      c.set("db", db);
    }

    await next();
  };
}
