/**
 * Database seed script.
 * Seeds 3 industry-vertical organizations with Medusa + Zendesk connectors,
 * agents, handwritten sessions, and ~300 generated sessions each.
 * Uses migration connection (superuser) to bypass RLS.
 */

import { getMigrationConnectionString } from "@lib/migration-url";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { connectorsCatalog } from "../schema";
import { connectorsCatalogSeed } from "./connectors-catalog";
import { seedOrg } from "./seed-org";
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
    },
    zendesk: {
      id: zendeskCatalog.id,
      slug: zendeskCatalog.slug,
      tools: zendeskCatalog.tools,
    },
  };

  // 2. Seed each vertical organization
  for (const config of VERTICALS) {
    await seedOrg(db, config, catalogs);
  }

  // 3. Print summary
  console.log("\n========================================");
  console.log("Seed completed successfully!");
  console.log("========================================");
  console.log("\nDev credentials (magic link auth):");
  for (const config of VERTICALS) {
    console.log(`\n  ${config.org.name} (${config.org.slug}):`);
    console.log(`    Admin:   ${config.users.admin.email}`);
    console.log(`    Support: ${config.users.support.email}`);
    console.log(`    Viewer:  ${config.users.viewer.email}`);
  }
  console.log("\nDemo-enabled org: glowbox (demoEnabled=true)");
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
