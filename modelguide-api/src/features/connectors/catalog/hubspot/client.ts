/**
 * HubSpot API client.
 *
 * Wraps the HubSpot v3 surface (CRM, Conversations, CMS Knowledge Base)
 * behind a single ConnectorFetcher. Adds HubSpot-specific 429 handling:
 * respects `Retry-After` when present, otherwise backs off when
 * `X-HubSpot-RateLimit-Remaining` is low.
 */

import { getLogger } from "@lib/logger";
import {
  ConnectorApiError,
  type ConnectorFetchOptions,
  type ConnectorFetcher,
} from "../lib/http-client";

export type { ConnectorFetcher as HubSpotFetcher };

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const MAX_RETRIES = 4;
const MAX_RETRY_DELAY_MS = 30_000;
const RATE_LIMIT_LOW_WATERMARK = 2;

interface CreateFetcherOptions {
  timeoutMs?: number;
  /** Override clock for tests. Returns milliseconds since epoch. */
  now?: () => number;
  /** Override sleeper for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function createHubSpotFetcher(
  config: Record<string, string>,
  options: CreateFetcherOptions = {},
): ConnectorFetcher {
  const { accessToken } = config;
  if (!accessToken) {
    throw new Error("HubSpot accessToken is required");
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  return async function hubspotFetch<T = unknown>(
    path: string,
    fetchOptions?: ConnectorFetchOptions,
  ): Promise<T> {
    const { method = "GET", body, params } = fetchOptions ?? {};

    let url = `${HUBSPOT_BASE_URL}${path}`;
    if (params) {
      const entries = Object.entries(params).filter(([, v]) => v !== undefined);
      if (entries.length > 0) {
        const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
        url += `?${qs}`;
      }
    }

    const log = getLogger();
    const callCtx = { connector: "HubSpot", method, path };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const start = performance.now();
      let response: Response;

      try {
        response = await fetch(url, {
          method,
          headers: { ...headers },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const duration = Math.round(performance.now() - start);
        log.error({ ...callCtx, duration, err }, "connector call error");
        throw err;
      }

      const duration = Math.round(performance.now() - start);

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delayMs = resolveRetryDelay(response.headers, attempt);
        log.warn(
          { ...callCtx, attempt, delayMs, status: 429 },
          "HubSpot rate limit hit; retrying",
        );
        await response.body?.cancel();
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        const raw = await response.text();
        const text = raw.length > 512 ? `${raw.slice(0, 512)}…` : raw;
        log.warn(
          { ...callCtx, status: response.status, duration },
          "connector call failed",
        );
        throw new ConnectorApiError("HubSpot", response.status, text);
      }

      log.info(
        { ...callCtx, status: response.status, duration },
        "connector call completed",
      );

      // Proactive backoff: if HubSpot says we're near the per-second limit,
      // pause briefly before returning so the *next* call doesn't 429.
      const remaining = parseRemaining(response.headers);
      if (remaining !== null && remaining <= RATE_LIMIT_LOW_WATERMARK) {
        await sleep(jitter(250));
      }

      if (response.status === 204) {
        return {} as T;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return (await response.text()) as unknown as T;
      }

      return (await response.json()) as T;
    }

    throw new ConnectorApiError(
      "HubSpot",
      429,
      `Exceeded ${MAX_RETRIES} retries on rate-limited request to ${path}`,
    );
  };
}

function resolveRetryDelay(headers: Headers, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
    }
  }
  const exponential = Math.min(
    1_000 * 2 ** attempt + jitter(250),
    MAX_RETRY_DELAY_MS,
  );
  return exponential;
}

function parseRemaining(headers: Headers): number | null {
  const raw = headers.get("x-hubspot-ratelimit-remaining");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
