/**
 * In-memory sliding-window rate limiter.
 * No external dependencies — uses a Map with periodic cleanup.
 */

import type { AppBindings } from "@/types";
import type { MiddlewareHandler } from "hono";

interface WindowEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Max requests per window. Default: 10 */
  limit?: number;
  /** Window size in seconds. Default: 60 */
  windowSeconds?: number;
}

export function rateLimit(
  options: RateLimitOptions = {},
): MiddlewareHandler<AppBindings> {
  const { limit = 10, windowSeconds = 60 } = options;
  const windowMs = windowSeconds * 1000;
  const store = new Map<string, WindowEntry>();

  // Cleanup stale entries every 5 minutes to prevent memory growth
  const cleanup = setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (entry.resetAt <= now) store.delete(key);
      }
    },
    5 * 60 * 1000,
  );

  // Allow GC if the timer is the only thing keeping the process alive
  if (cleanup.unref) cleanup.unref();

  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || entry.resetAt <= now) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", String(limit - 1));
      await next();
      return;
    }

    entry.count++;

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", "0");
      return c.json(
        { code: "RATE_LIMITED", message: "Too many requests" },
        429,
      );
    }

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(limit - entry.count));
    await next();
  };
}
