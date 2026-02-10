/**
 * Shared HTTP client infrastructure for connector modules.
 * Provides a base fetcher factory, error class, and handler wrapper
 * so each connector only defines its auth and URL logic.
 */

import type { ToolExecutionContext, ToolExecutionResult } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectorFetchOptions {
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

export type ConnectorFetcher = <T = unknown>(
  path: string,
  options?: ConnectorFetchOptions,
) => Promise<T>;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ConnectorApiError extends Error {
  constructor(
    public readonly connectorName: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${connectorName} API error ${status}: ${body}`);
    this.name = "ConnectorApiError";
  }
}

// ---------------------------------------------------------------------------
// Fetcher factory
// ---------------------------------------------------------------------------

export function createBaseFetcher(
  baseUrl: string,
  headers: Record<string, string>,
  connectorName: string,
  timeoutMs = 30_000,
): ConnectorFetcher {
  return async function connectorFetch<T = unknown>(
    path: string,
    options?: ConnectorFetchOptions,
  ): Promise<T> {
    const { method = "GET", body, params } = options ?? {};

    let url = `${baseUrl}${path}`;
    if (params) {
      const entries = Object.entries(params).filter(([, v]) => v !== undefined);
      if (entries.length > 0) {
        const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
        url += `?${qs}`;
      }
    }

    const response = await fetch(url, {
      method,
      headers: { ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const raw = await response.text();
      const text = raw.length > 512 ? `${raw.slice(0, 512)}…` : raw;
      throw new ConnectorApiError(connectorName, response.status, text);
    }

    return response.json() as Promise<T>;
  };
}

// ---------------------------------------------------------------------------
// Handler helpers
// ---------------------------------------------------------------------------

export function connectorErrorResult(err: unknown): ToolExecutionResult {
  if (err instanceof ConnectorApiError) {
    return {
      success: false,
      error: `${err.connectorName} API ${err.status}: ${err.body}`,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: message };
}

export function withConnector(
  createFetcherFn: (config: Record<string, string>) => ConnectorFetcher,
) {
  return function wrap(
    fn: (
      fetcher: ConnectorFetcher,
      ctx: ToolExecutionContext,
    ) => Promise<ToolExecutionResult>,
  ): (ctx: ToolExecutionContext) => Promise<ToolExecutionResult> {
    return async function handler(ctx) {
      try {
        const fetcher = createFetcherFn(ctx.config);
        return await fn(fetcher, ctx);
      } catch (err) {
        return connectorErrorResult(err);
      }
    };
  };
}
