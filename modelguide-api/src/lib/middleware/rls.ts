/**
 * Row-Level Security (RLS) middleware
 * Sets PostgreSQL session variables for RLS policies
 */

import type { AppBindings } from "@/types";
import { db } from "@db/client";
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

/**
 * Set RLS context for the current database connection
 * This sets app.organization_id as a session variable that RLS policies can use
 * Uses set_config() function for proper parameterized value passing
 * The third parameter `false` means session-level (persists for connection lifetime)
 */
export async function setRLSContext(organizationId: string): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.organization_id', ${organizationId}, false)`,
  );
}

/**
 * Clear RLS context by setting it to empty string
 * Uses set_config() for consistency
 */
export async function clearRLSContext(): Promise<void> {
  await db.execute(sql`SELECT set_config('app.organization_id', '', false)`);
}

/**
 * Execute a function with RLS context set
 * Ensures context is cleared even if function throws
 */
export async function withRLSContext<T>(
  organizationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await setRLSContext(organizationId);
  try {
    return await fn();
  } finally {
    await clearRLSContext();
  }
}

/**
 * Middleware that sets RLS context from organization ID
 * Note: This should be used after authMiddleware which sets organizationId
 *
 * IMPORTANT: This middleware requires that database queries are wrapped
 * in a transaction to ensure the SET LOCAL persists for the connection.
 * For single queries, consider using withRLSContext instead.
 */
export function rlsMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const organizationId = c.get("organizationId");

    if (organizationId) {
      // Set RLS context at the start of the request
      await setRLSContext(organizationId);

      try {
        await next();
      } finally {
        // Clear context at the end
        await clearRLSContext();
      }
    } else {
      // No organization context, just continue
      await next();
    }
  };
}

/**
 * Utility to check if RLS context is currently set
 * Useful for debugging
 */
export async function getRLSContext(): Promise<string | null> {
  try {
    const result = await db.execute(
      sql`SELECT current_setting('app.organization_id', true)`,
    );
    const row = result as unknown as Array<{ current_setting: string | null }>;
    return row[0]?.current_setting ?? null;
  } catch {
    return null;
  }
}

/**
 * Execute a function with RLS bypass enabled within a transaction
 * The bypass is transaction-scoped so it doesn't leak to other connections
 * Use for auth operations that need to access users before org context is established
 */
export async function withRLSBypass<T>(
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set bypass flag for this transaction only (true = transaction-local)
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return fn(tx as unknown as typeof db);
  });
}
