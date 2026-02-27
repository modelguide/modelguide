/**
 * CLI script to sync connector manifests into the database.
 * Updates connectors_catalog, connector_tools, and agent_connector_tools.
 *
 * Usage: bun run src/features/connectors/catalog/sync.ts
 */

import { loadAllManifests } from "./registry";
import { syncCatalogAndTools } from "./sync-tools";

async function sync() {
  console.log("Loading connector manifests...");
  const manifests = await loadAllManifests();
  console.log(`Found ${manifests.length} connector(s)`);

  await syncCatalogAndTools();

  console.log("Sync complete.");
  process.exit(0);
}

sync().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
