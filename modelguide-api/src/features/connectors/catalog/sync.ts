/**
 * CLI script to sync connector manifests from code into the connectors_catalog DB table.
 *
 * Usage: bun run src/features/connectors/catalog/sync.ts
 */

import { db } from "@db/client";
import type { NewConnectorCatalog } from "@db/schema";
import { connectorsCatalog } from "@db/schema";
import { notInArray } from "drizzle-orm";
import { loadAllManifests } from "./registry";

async function sync() {
  console.log("Loading connector manifests...");
  const manifests = await loadAllManifests();
  console.log(`Found ${manifests.length} connector(s)`);

  const slugs = manifests.map((m) => m.slug);

  for (const manifest of manifests) {
    const row: NewConnectorCatalog = {
      name: manifest.name,
      slug: manifest.slug,
      description: manifest.description,
      connectorType: manifest.connectorType,
      configSchema: manifest.configSchema,
      tools: manifest.tools.map((t) => t.catalog),
      authMethods: manifest.authMethods,
      iconUrl: manifest.iconUrl,
      isActive: true,
    };

    await db
      .insert(connectorsCatalog)
      .values(row)
      .onConflictDoUpdate({
        target: connectorsCatalog.slug,
        set: {
          name: row.name,
          description: row.description,
          connectorType: row.connectorType,
          configSchema: row.configSchema,
          tools: row.tools,
          authMethods: row.authMethods,
          iconUrl: row.iconUrl,
          isActive: true,
        },
      });

    console.log(`  Upserted: ${manifest.name} (${manifest.slug})`);
  }

  if (slugs.length > 0) {
    const deactivated = await db
      .update(connectorsCatalog)
      .set({ isActive: false })
      .where(notInArray(connectorsCatalog.slug, slugs))
      .returning({ slug: connectorsCatalog.slug });

    if (deactivated.length > 0) {
      for (const d of deactivated) {
        console.log(`  Deactivated: ${d.slug}`);
      }
    }
  }

  console.log("Sync complete.");
  process.exit(0);
}

sync().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
