import { db } from "@db/client";
import type { Database } from "@db/client";
import { sql } from "drizzle-orm";

/**
 * Execute a function within a transaction with RLS context set.
 * This ensures set_config and queries run on the same connection.
 */
export async function withRLSTransaction<T>(
  organizationId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.organization_id', ${organizationId}, true)`,
    );
    return fn(tx as unknown as Database);
  });
}

/**
 * Execute a function within a transaction WITHOUT RLS context (empty org_id).
 * This simulates no authentication context.
 */
export async function withoutRLSTransaction<T>(
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organization_id', '', true)`);
    return fn(tx as unknown as Database);
  });
}
