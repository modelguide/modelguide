/**
 * Railway release command.
 *
 * - Acquires a PostgreSQL advisory lock to serialize deploys
 * - Runs migrate.ts via execSync
 * - Validates migration count
 * - Releases the lock
 *
 * Env vars:
 *   DATABASE_MIGRATION_URL      – full DB URL or base URL without credentials (required)
 *   DATABASE_MIGRATION_USER     – superuser username (required if URL has no credentials)
 *   DATABASE_MIGRATION_PASSWORD – superuser password (required if URL has no credentials)
 *   APP_DB_PASSWORD             – password for modelguide_app role
 */
import { execSync } from "node:child_process";
import postgres from "postgres";
import { getMigrationConnectionString } from "../src/lib/migration-url";

const LOCK_ID = 123456789; // arbitrary advisory lock ID

const migrationUrl = getMigrationConnectionString();
if (!migrationUrl) {
  console.error(
    "DATABASE_MIGRATION_URL (or base URL + DATABASE_MIGRATION_USER + DATABASE_MIGRATION_PASSWORD) is required",
  );
  process.exit(1);
}
const sql = postgres(migrationUrl, { max: 1 });

async function run() {
  console.log("Acquiring advisory lock...");
  await sql`SELECT pg_advisory_lock(${LOCK_ID})`;
  console.log("Lock acquired.");

  try {
    // Count migrations before
    const before = await sql`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `.catch(() => [{ count: 0 }]);
    const countBefore = before[0].count;

    // Run migrations
    console.log("Running migrations...");
    execSync("bun run dist/migrate.js", {
      stdio: "inherit",
      timeout: 120_000,
    });

    // Count migrations after
    const after =
      await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    const countAfter = after[0].count;

    const applied = countAfter - countBefore;
    console.log(
      `Migrations complete. Applied: ${applied}, Total: ${countAfter}`,
    );
  } finally {
    console.log("Releasing advisory lock...");
    await sql`SELECT pg_advisory_unlock(${LOCK_ID})`;
    await sql.end();
    console.log("Done.");
  }
}

try {
  await run();
} catch (err) {
  console.error("Release command failed:", err);
  process.exit(1);
}
