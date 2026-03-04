/**
 * Structured logger (Pino) with async buffered I/O.
 *
 * - JSON output in production, pino-pretty transport in development
 * - Redacts common sensitive field names as a safety net
 * - Services handling secrets must use mask() explicitly — redact is the last line of defense
 */

import { env } from "@/env";
import { tryGetContext } from "hono/context-storage";
import pino from "pino";

const isDev = env.NODE_ENV === "development";

// In production: async buffered file destination (JSON to stdout).
// In development: pino-pretty transport for human-readable output.
// destination is null when using a transport (pino manages the stream).
export const destination = isDev ? null : pino.destination({ sync: false });

const pinoOpts: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      // Auth & secrets (top-level + deep)
      "authorization",
      "cookie",
      "encryptedValue",
      "password",
      "token",
      "apiKey",
      "req.headers.authorization",
      "req.headers.cookie",
      // Deep wildcards — catch PII inside connector payloads (body, response)
      "**.password",
      "**.token",
      "**.apiKey",
      "**.api_key",
      "**.secret",
      "**.authorization",
      "**.cookie",
      "**.encryptedValue",
      "**.email",
      "**.phone",
      "**.first_name",
      "**.last_name",
    ],
    censor: "[REDACTED]",
  },
  base: { service: "modelguide-api" },
  ...(isDev && {
    transport: {
      target: "pino-pretty",
    },
  }),
};

export const logger = destination
  ? pino(pinoOpts, destination)
  : pino(pinoOpts);

/**
 * Get the request-scoped logger (with requestId) when inside a request,
 * or fall back to the root logger outside a request (startup, tests, cron).
 */
export function getLogger(): pino.Logger {
  const ctx = tryGetContext();
  return (
    ((ctx?.get as (key: string) => unknown)?.("logger") as pino.Logger) ??
    logger
  );
}

/**
 * Create a child logger with additional bindings and store it back in the
 * Hono request context. Subsequent `getLogger()` calls within the same
 * request will return the enriched logger. No-op outside a request context.
 */
export function enrichLogger(bindings: Record<string, unknown>): void {
  const ctx = tryGetContext();
  if (!ctx) return;
  const current = getLogger();
  (ctx.set as (key: string, value: unknown) => void)(
    "logger",
    current.child(bindings),
  );
}

/**
 * Run an async function with timing instrumentation.
 * Logs duration on both success and failure.
 */
export async function withTiming<T>(
  log: pino.Logger,
  context: Record<string, unknown>,
  successMsg: string,
  errorMsg: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    log.info(
      { ...context, duration: Math.round(performance.now() - start) },
      successMsg,
    );
    return result;
  } catch (err) {
    log.error(
      { err, ...context, duration: Math.round(performance.now() - start) },
      errorMsg,
    );
    throw err;
  }
}
