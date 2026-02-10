/**
 * Seed data for connectors catalog.
 * These are the global connector templates available to all organizations.
 *
 * Connector modules that have a manifest (in features/connectors/catalog/)
 * are converted via manifestToSeed to avoid duplicating tool definitions.
 */

import medusaManifest from "@features/connectors/catalog/medusa/index";
import type { ConnectorManifest } from "@features/connectors/catalog/types";
import zendeskManifest from "@features/connectors/catalog/zendesk/index";
import type { NewConnectorCatalog } from "../schema";

/**
 * Derives a seed-ready catalog entry from a connector manifest,
 * stripping handler functions and keeping only catalog metadata.
 */
function manifestToSeed(manifest: ConnectorManifest): NewConnectorCatalog {
  return {
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
}

export const medusaConnector: NewConnectorCatalog =
  manifestToSeed(medusaManifest);

export const zendeskConnector: NewConnectorCatalog =
  manifestToSeed(zendeskManifest);

export const connectorsCatalogSeed: NewConnectorCatalog[] = [
  medusaConnector,
  zendeskConnector,
];
