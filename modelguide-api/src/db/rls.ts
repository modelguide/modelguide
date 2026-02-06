import { sql } from "drizzle-orm";
import { db } from "./client";

/** Transaction type derived from db.transaction callback parameter. */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function forOrg<T>(
  organizationId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.organization_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}

export async function forApp<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.bypass_rls', 'on', true)`,
    );
    return fn(tx);
  });
}
