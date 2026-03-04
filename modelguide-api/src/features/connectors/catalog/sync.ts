/**
 * CLI script to sync connector manifests into the database.
 * Updates connectors_catalog, connector_tools, and agent_connector_tools.
 *
 * Usage: bun run src/features/connectors/catalog/sync.ts
 */

import { getLogger } from "@lib/logger";
import { loadAllManifests } from "./registry";
import { syncCatalogAndTools } from "./sync-tools";

async function sync() {
  getLogger().info("loading connector manifests");
  const manifests = await loadAllManifests();
  getLogger().info({ count: manifests.length }, "connectors found");

  await syncCatalogAndTools();

  getLogger().info("sync complete");
  process.exit(0);
}

sync().catch((err) => {
  getLogger().fatal({ err }, "sync failed");
  process.exit(1);
});
