/**
 * Bun preload script for integration tests.
 *
 * Starts a disposable PostgreSQL container via Testcontainers,
 * sets all required env vars, runs Drizzle migrations, and seeds test data
 * BEFORE any test module is imported.
 *
 * Usage: bun test --preload ./tests/setup/integration-preload.ts tests/integration
 */

import path from "node:path";
import { GenericContainer, Wait } from "testcontainers";

const PG_USER = "modelguide";
const PG_PASSWORD = "modelguide";
const PG_DB = "modelguide";
const PG_IMAGE = "postgres:16-alpine";

const INIT_SQL_PATH = path.resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "docker",
  "postgres",
  "init.sql",
);

// Start a PostgreSQL container with the init script
const container = await new GenericContainer(PG_IMAGE)
  .withEnvironment({
    POSTGRES_USER: PG_USER,
    POSTGRES_PASSWORD: PG_PASSWORD,
    POSTGRES_DB: PG_DB,
  })
  .withExposedPorts(5432)
  .withCopyFilesToContainer([
    {
      source: INIT_SQL_PATH,
      target: "/docker-entrypoint-initdb.d/init.sql",
    },
  ])
  .withWaitStrategy(
    Wait.forLogMessage(/database system is ready to accept connections/, 2),
  )
  .start();

const host = container.getHost();
const port = container.getMappedPort(5432);

// App connects as modelguide_app (subject to RLS)
const appUrl = `postgresql://modelguide_app:modelguide_app@${host}:${port}/${PG_DB}`;
// Migrations connect as superuser (owns tables)
const migrationUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@${host}:${port}/${PG_DB}`;

// Set env vars BEFORE any test module loads (which triggers env.ts validation)
process.env.DATABASE_URL = appUrl;
process.env.DATABASE_MIGRATION_URL = migrationUrl;
process.env.DATABASE_MIGRATION_USER = PG_USER;
process.env.DATABASE_MIGRATION_PASSWORD = PG_PASSWORD;
process.env.APP_DB_PASSWORD = "modelguide_app";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env.REFRESH_JWT_SECRET =
  "test-refresh-jwt-secret-at-least-32-chars-long";
process.env.ENCRYPTION_KEY = "test-encryption-key-at-least-32-characters-long";
process.env.APP_URL = "http://localhost:3000";
process.env.MAGIC_LINK_SECRET =
  "test-magic-link-secret-that-is-at-least-32-characters-long";
process.env.LOG_LEVEL = "silent";

// Run Drizzle migrations as superuser
const { getMigrationConnectionString } = await import(
  "../../src/lib/migration-url"
);
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const postgres = (await import("postgres")).default;

const resolvedMigrationUrl = getMigrationConnectionString();
const migrationClient = postgres(resolvedMigrationUrl, { max: 1 });
const migrationDb = drizzle(migrationClient);

const migrationsFolder = path.resolve(import.meta.dir, "..", "..", "drizzle");

await migrate(migrationDb, { migrationsFolder });
await migrationClient.end();

// Run seed as superuser (creates orgs, users, connectors, agents, etc.)
const { runSeed } = await import("../../src/db/seed/index");
await runSeed(resolvedMigrationUrl);

console.log(
  `[integration-preload] PostgreSQL container ready at ${host}:${port}`,
);

// Stop container on process exit
process.on("beforeExit", async () => {
  console.log("[integration-preload] Stopping PostgreSQL container...");
  const { closeAppDb } = await import("../helpers/rls");
  await closeAppDb();
  const { closeDatabase } = await import("../../src/db/client");
  await closeDatabase();
  await container.stop();
});
