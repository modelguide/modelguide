/**
 * Medusa v2 Store API HTTP client.
 * Creates a fetcher bound to a specific connector instance's config.
 */

interface MedusaFetchOptions {
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

export class MedusaApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Medusa API error ${status}: ${body}`);
    this.name = "MedusaApiError";
  }
}

export function createMedusaFetcher(config: Record<string, string>) {
  const baseUrl = config.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Medusa baseUrl is required");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  if (config.publishableKey) {
    headers["x-publishable-api-key"] = config.publishableKey;
  }

  return async function medusaFetch<T = unknown>(
    path: string,
    options?: MedusaFetchOptions,
  ): Promise<T> {
    const { method = "GET", body, params } = options ?? {};

    let url = `${baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += `?${qs}`;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new MedusaApiError(response.status, text);
    }

    return response.json() as Promise<T>;
  };
}
