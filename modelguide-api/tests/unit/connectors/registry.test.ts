/**
 * Unit tests for connector registry
 */

import { describe, expect, test } from "bun:test";
import {
  getAllManifests,
  getConnectorManifest,
  loadAllManifests,
} from "@features/connectors/catalog/registry";

describe("Connector registry", () => {
  test("loadAllManifests returns expected count", async () => {
    const manifests = await loadAllManifests();
    expect(manifests.length).toBeGreaterThanOrEqual(1);
  });

  test("getConnectorManifest('medusa') returns the manifest", () => {
    const manifest = getConnectorManifest("medusa");
    expect(manifest).toBeDefined();
    expect(manifest!.slug).toBe("medusa");
    expect(manifest!.name).toBe("Medusa");
  });

  test("getConnectorManifest('nonexistent') returns undefined", () => {
    const manifest = getConnectorManifest("nonexistent");
    expect(manifest).toBeUndefined();
  });

  test("getAllManifests returns all loaded manifests", () => {
    const manifests = getAllManifests();
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    const slugs = manifests.map((m) => m.slug);
    expect(slugs).toContain("medusa");
  });
});
