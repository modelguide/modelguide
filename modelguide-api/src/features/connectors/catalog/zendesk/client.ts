/**
 * Zendesk Support API v2 HTTP client.
 * Creates a fetcher bound to a specific connector instance's config.
 * Uses Basic auth: email/token:{apiToken}
 */

import { type ConnectorFetcher, createBaseFetcher } from "../lib/http-client";

export type { ConnectorFetcher as ZendeskFetcher };

export function createZendeskFetcher(
  config: Record<string, string>,
): ConnectorFetcher {
  const { subdomain, email, apiToken } = config;

  if (!subdomain) throw new Error("Zendesk subdomain is required");
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(subdomain)) {
    throw new Error("Zendesk subdomain contains invalid characters");
  }
  if (!email) throw new Error("Zendesk email is required");
  if (!apiToken) throw new Error("Zendesk apiToken is required");

  const baseUrl = `https://${subdomain}.zendesk.com/api/v2`;
  const credentials = btoa(`${email}/token:${apiToken}`);

  return createBaseFetcher(
    baseUrl,
    {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
    },
    "Zendesk",
  );
}
