import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
/**
 * Database migration script.
 *
 * - Provisions the modelguide_app role (idempotent)
 * - Runs Drizzle migrations as the migration user
 * - Grants privileges on any newly-created tables
 *
 * Env vars:
 *   DATABASE_MIGRATION_URL      – full DB URL or base URL without credentials (required)
 *   DATABASE_MIGRATION_USER     – superuser username (required if URL has no credentials)
 *   DATABASE_MIGRATION_PASSWORD – superuser password (required if URL has no credentials)
 *   APP_DB_PASSWORD             – password for modelguide_app role (required)
 */
import { getMigrationConnectionString } from "../src/lib/migration-url";

function requireEnv(name: string, validate?: (value: string) => void): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  validate?.(value);
  return value;
}

const migrationUrl = getMigrationConnectionString();
if (!migrationUrl) {
  console.error(
    "DATABASE_MIGRATION_URL (or base URL + DATABASE_MIGRATION_USER + DATABASE_MIGRATION_PASSWORD) is required",
  );
  process.exit(1);
}
const migrationUser = new URL(migrationUrl).username;
const appPassword = requireEnv("APP_DB_PASSWORD");

const sql = postgres(migrationUrl, { max: 1 });

const dbName = new URL(migrationUrl).pathname.slice(1);

async function provisionRole() {
  // Idempotent: create role if missing, always set password.
  // DDL PASSWORD clauses don't support $1 parameterized queries,
  // so we use PL/pgSQL format() + EXECUTE to safely quote the password.
  const [{ exists }] = await sql`
    SELECT EXISTS(SELECT FROM pg_roles WHERE rolname = 'modelguide_app') AS exists
  `;
  // Build DDL via format() (parameterised) then execute the safe string.
  // DO blocks don't support $1 params, so we avoid them entirely.
  if (!exists) {
    const [{ cmd }] =
      await sql`SELECT format('CREATE ROLE modelguide_app WITH LOGIN PASSWORD %L NOSUPERUSER', ${appPassword}::text) AS cmd`;
    await sql.unsafe(cmd);
  } else {
    const [{ cmd }] =
      await sql`SELECT format('ALTER ROLE modelguide_app WITH PASSWORD %L', ${appPassword}::text) AS cmd`;
    await sql.unsafe(cmd);
  }
}

async function grantPrivileges() {
  await sql`GRANT CONNECT ON DATABASE ${sql(dbName)} TO modelguide_app`;
  await sql`GRANT USAGE ON SCHEMA public TO modelguide_app`;
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modelguide_app`;
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modelguide_app`;

  // Default privileges for future tables created by the migration user
  await sql`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${sql(migrationUser)} IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modelguide_app
  `;
  await sql`
    ALTER DEFAULT PRIVILEGES FOR ROLE ${sql(migrationUser)} IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO modelguide_app
  `;
}

async function run() {
  console.log("Provisioning modelguide_app role...");
  await provisionRole();

  await grantPrivileges();

  console.log("Running Drizzle migrations...");
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Re-grant on any tables created by migrations
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modelguide_app`;
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modelguide_app`;

  console.log("Migrations complete.");
}

try {
  await run();
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
