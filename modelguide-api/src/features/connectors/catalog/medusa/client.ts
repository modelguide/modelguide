/**
 * Medusa v2 HTTP clients (Store + Admin API).
 * Creates fetchers bound to a specific connector instance's config.
 */

import { type ConnectorFetcher, createBaseFetcher } from "../lib/http-client";
import { validateBaseUrl } from "../lib/validate-url";

export type { ConnectorFetcher as MedusaFetcher };

export function createMedusaFetcher(
  config: Record<string, string>,
  timeoutMs?: number,
): ConnectorFetcher {
  if (!config.baseUrl) {
    throw new Error("Medusa baseUrl is required");
  }
  const baseUrl = validateBaseUrl(config.baseUrl, "Medusa");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.publishableKey) {
    headers["x-publishable-api-key"] = config.publishableKey;
  }

  return createBaseFetcher(baseUrl, headers, "Medusa", timeoutMs);
}

export function createMedusaAdminFetcher(
  config: Record<string, string>,
): ConnectorFetcher {
  if (!config.baseUrl) {
    throw new Error("Medusa baseUrl is required");
  }
  const baseUrl = validateBaseUrl(config.baseUrl, "Medusa");

  const secretApiKey = config.secretApiKey;
  if (!secretApiKey) {
    throw new Error("Medusa secretApiKey is required for admin operations");
  }

  return createBaseFetcher(
    baseUrl,
    {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${secretApiKey}:`)}`,
    },
    "Medusa Admin",
  );
}
