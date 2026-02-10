/**
 * Medusa v2 Store API HTTP client.
 * Creates a fetcher bound to a specific connector instance's config.
 */

import { type ConnectorFetcher, createBaseFetcher } from "../lib/http-client";

export type { ConnectorFetcher as MedusaFetcher };

export function createMedusaFetcher(
  config: Record<string, string>,
): ConnectorFetcher {
  const baseUrl = config.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Medusa baseUrl is required");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.publishableKey) {
    headers["x-publishable-api-key"] = config.publishableKey;
  }

  return createBaseFetcher(baseUrl, headers, "Medusa");
}
