/**
 * In-memory connector registry for O(1) manifest lookups.
 */

import type { ConnectorManifest } from "./types";

const registry = new Map<string, ConnectorManifest>();

export function registerConnector(manifest: ConnectorManifest): void {
  registry.set(manifest.slug, manifest);
}

export function getConnectorManifest(
  slug: string,
): ConnectorManifest | undefined {
  return registry.get(slug);
}

export function getAllManifests(): ConnectorManifest[] {
  return Array.from(registry.values());
}

export async function loadAllManifests(): Promise<ConnectorManifest[]> {
  const modules = await Promise.all([
    import("./medusa/index"),
    import("./zendesk/index"),
  ]);

  for (const mod of modules) {
    registerConnector(mod.default);
  }

  return getAllManifests();
}
