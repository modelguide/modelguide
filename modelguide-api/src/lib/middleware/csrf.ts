/**
 * CSRF protection middleware using Origin header validation (fail-closed).
 *
 * Rejects requests where:
 * - Both Origin and Referer headers are missing (fail-closed)
 * - Origin (or Referer fallback) doesn't match APP_URL
 */

import { env } from "@/env";
import { AppError, ErrorCode } from "@lib/errors";
import type { Context, Next } from "hono";

export function csrfProtection() {
  return async (c: Context, next: Next) => {
    const origin = c.req.header("Origin");
    const referer = c.req.header("Referer");

    let requestOrigin: string | null = null;

    if (origin) {
      requestOrigin = origin;
    } else if (referer) {
      try {
        const url = new URL(referer);
        requestOrigin = url.origin;
      } catch {
        // Malformed Referer — treat as missing
      }
    }

    if (!requestOrigin) {
      throw new AppError(
        ErrorCode.CSRF_REJECTED,
        "CSRF validation failed: missing Origin header",
      );
    }

    const appOrigin = new URL(env.APP_URL).origin;

    if (requestOrigin !== appOrigin) {
      throw new AppError(
        ErrorCode.CSRF_REJECTED,
        "CSRF validation failed: origin mismatch",
      );
    }

    await next();
  };
}
