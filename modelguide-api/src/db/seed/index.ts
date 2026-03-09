/**
 * Database seed script.
 * Seeds 3 industry-vertical organizations with Medusa + Zendesk connectors,
 * agents, handwritten sessions, and ~300 generated sessions each.
 * Uses migration connection (superuser) to bypass RLS.
 */

import { getMigrationConnectionString } from "@lib/migration-url";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { connectorsCatalog, sopTemplates } from "../schema";
import { connectorsCatalogSeed } from "./connectors-catalog";
import { seedOrg } from "./seed-org";
import { seedSopDefinitions } from "./seed-sop-defs";
import { sopTemplatesSeed } from "./sop-templates";
import clearhealthConfig from "./verticals/clearhealth";
import glowboxConfig from "./verticals/glowbox";
import steelpointConfig from "./verticals/steelpoint";

type SeedDb = PostgresJsDatabase<typeof schema>;

const VERTICALS = [glowboxConfig, clearhealthConfig, steelpointConfig];

export async function runSeed(connectionString: string) {
  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient, { schema });

  try {
    await seedAll(db);
  } finally {
    await queryClient.end();
  }
}

async function seedAll(db: SeedDb) {
  console.log("Starting database seed...\n");

  // 1. Seed connectors catalog (global)
  console.log("Seeding connectors catalog...");
  const catalogEntries = await db
    .insert(connectorsCatalog)
    .values(connectorsCatalogSeed)
    .onConflictDoNothing()
    .returning();
  console.log(`  Created ${catalogEntries.length} catalog entries`);

  // Look up both catalog entries
  const medusaCatalog = await db.query.connectorsCatalog.findFirst({
    where: (cat, { eq }) => eq(cat.slug, "medusa"),
  });
  const zendeskCatalog = await db.query.connectorsCatalog.findFirst({
    where: (cat, { eq }) => eq(cat.slug, "zendesk"),
  });

  if (!medusaCatalog || !zendeskCatalog) {
    console.error("Failed to find Medusa and/or Zendesk catalog entries");
    process.exit(1);
  }

  const catalogs = {
    medusa: {
      id: medusaCatalog.id,
      slug: medusaCatalog.slug,
      tools: medusaCatalog.tools,
      configSchema: medusaCatalog.configSchema,
    },
    zendesk: {
      id: zendeskCatalog.id,
      slug: zendeskCatalog.slug,
      tools: zendeskCatalog.tools,
      configSchema: zendeskCatalog.configSchema,
    },
  };

  // 2. Seed SOP templates (global)
  console.log("\nSeeding SOP templates...");
  const templateEntries = await db
    .insert(sopTemplates)
    .values(sopTemplatesSeed)
    .onConflictDoNothing()
    .returning();
  console.log(`  Created ${templateEntries.length} SOP templates`);

  // 3. Seed each vertical organization
  for (const config of VERTICALS) {
    await seedOrg(db, config, catalogs);
  }

  // 4. Seed SOP definitions for demo org (glowbox)
  await seedSopDefinitions(db);

  // 5. Verify data was actually persisted
  const ok = await verifySeed(db);

  // 6. Print summary
  console.log("\n========================================");
  console.log(
    ok
      ? "Seed completed successfully!"
      : "Seed completed with WARNINGS — see above",
  );
  console.log("========================================");
  console.log("\nDev credentials (magic link auth):");
  for (const config of VERTICALS) {
    console.log(`\n  ${config.org.name} (${config.org.slug}):`);
    console.log(`    Admin:   ${config.users.admin.email}`);
    console.log(`    Support: ${config.users.support.email}`);
    console.log(`    Viewer:  ${config.users.viewer.email}`);
  }
  console.log("\nDemo-enabled org: glowbox (demoEnabled=true)");

  if (!ok) {
    process.exitCode = 1;
  }
}

const MIN_ROW_COUNTS: Record<string, number> = {
  organizations: 3,
  users: 9, // 3 per org
  agents: 6,
  connectors: 6,
  connector_tools: 1,
  sessions: 300, // ~300 generated per org, plus handwritten
  session_messages: 100,
  session_feedback: 50,
};

async function verifySeed(db: SeedDb): Promise<boolean> {
  console.log("\nVerifying seed data...");

  const tables = Object.keys(MIN_ROW_COUNTS);
  const counts: Record<string, number> = {};

  for (const tbl of tables) {
    const [row] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM ${sql.identifier(tbl)}`,
    );
    counts[tbl] = row.count;
  }

  let ok = true;
  const widest = Math.max(...tables.map((t) => t.length));

  for (const tbl of tables) {
    const count = counts[tbl];
    const min = MIN_ROW_COUNTS[tbl];
    const fail = count < min;
    const marker = fail ? "FAIL" : " ok ";
    console.log(
      `  [${marker}] ${tbl.padEnd(widest)}  ${count}${fail ? `  (expected >= ${min})` : ""}`,
    );
    if (fail) ok = false;
  }

  if (ok) {
    console.log("  All tables verified.");
  } else {
    console.error("  WARNING: Some tables have fewer rows than expected!");
  }

  return ok;
}

// CLI entry point
if (import.meta.main) {
  console.log("Resolving connection string...");
  const connectionString = getMigrationConnectionString();

  if (!connectionString) {
    console.error(
      "Set DATABASE_MIGRATION_URL (or base URL + DATABASE_MIGRATION_USER + DATABASE_MIGRATION_PASSWORD), or DATABASE_URL",
    );
    process.exit(1);
  }

  const redacted = connectionString.replace(
    /\/\/([^:]+):([^@]+)@/,
    "//$1:***@",
  );
  console.log(`Connecting to: ${redacted}`);

  const start = performance.now();
  runSeed(connectionString)
    .then(() => {
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      console.log(`\nDone in ${elapsed}s`);
    })
    .catch((error) => {
      console.error("Seed failed:", error);
      process.exit(1);
    });
}
