/**
 * One-off script to seed SOPs, templates, guardrails, and compile agents
 * against an existing Railway database that already has orgs/agents/connectors.
 *
 * Usage:
 *   cd modelguide-api
 *   railway run --service modelguide-api -- bun run src/db/seed/seed-sops-railway.ts
 *
 * What it seeds (all idempotent via onConflictDoNothing):
 *   1. SOP templates (global catalog)
 *   2. SOP definitions for GlowBox (with eval configs + steps)
 *   3. Knowledge base guardrails (all 3 orgs)
 *   4. Compiles agents from assigned SOPs + guardrails
 */

import { getMigrationConnectionString } from "@lib/migration-url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { sopTemplates } from "../schema";
import { seedCompileAgents } from "./seed-compile-agents";
import { seedKnowledgeBase } from "./seed-knowledge-base";
import { seedSopDefinitions } from "./seed-sop-defs";
import { sopTemplatesSeed } from "./sop-templates";

async function main() {
  const connectionString = getMigrationConnectionString();
  if (!connectionString) {
    console.error(
      "No connection string. Set DATABASE_MIGRATION_URL or DATABASE_URL.",
    );
    process.exit(1);
  }

  const redacted = connectionString.replace(
    /\/\/([^:]+):([^@]+)@/,
    "//$1:***@",
  );
  console.log(`Connecting to: ${redacted}`);

  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient, { schema });

  try {
    // 1. SOP templates (global)
    console.log("\n--- Seeding SOP templates ---");
    const templateEntries = await db
      .insert(sopTemplates)
      .values(sopTemplatesSeed)
      .onConflictDoNothing()
      .returning();
    console.log(`  Created ${templateEntries.length} SOP templates`);

    // 2. SOP definitions for GlowBox (active + draft, with eval configs)
    await seedSopDefinitions(db);

    // 3. Knowledge base guardrails (all 3 orgs)
    await seedKnowledgeBase(db);

    // 4. Compile agents from assigned SOPs + guardrails
    await seedCompileAgents(db);

    console.log("\n========================================");
    console.log("SOP seed completed successfully!");
    console.log("========================================");
  } catch (err) {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await queryClient.end();
  }
}

main();
