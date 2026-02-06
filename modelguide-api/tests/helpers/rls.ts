import { env } from "@/env";
import type { Database } from "@db/client";
import * as schema from "@db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Separate connection as modelguide_app (non-superuser, subject to RLS).
 * The main DATABASE_URL uses the superuser which bypasses RLS entirely.
 */
const appUrl = env.DATABASE_URL.replace(
  /\/\/[^:]+:[^@]+@/,
  "//modelguide_app:modelguide_app@",
);
const appClient = postgres(appUrl);
const appDb = drizzle(appClient, { schema });

export async function closeAppDb(): Promise<void> {
  await appClient.end();
}

/**
 * Execute a function within a transaction with RLS context set.
 * Uses the app role connection so RLS policies are enforced.
 */
export async function withRLSTransaction<T>(
  organizationId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
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
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organization_id', '', true)`);
    return fn(tx as unknown as Database);
  });
}
