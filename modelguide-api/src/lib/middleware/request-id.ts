/**
 * Request ID middleware.
 *
 * Reads X-Request-Id from the incoming request or generates a new UUID.
 * Creates a child logger scoped to the request and logs request start/completion.
 */

import type { AppBindings } from "@/types";
import { logger } from "@lib/logger";
import type { MiddlewareHandler } from "hono";

export function requestId(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const id = c.req.header("X-Request-Id") ?? crypto.randomUUID();
    const reqLogger = logger.child({ requestId: id });

    c.set("requestId", id);
    c.set("logger", reqLogger);
    c.header("X-Request-Id", id);

    const start = performance.now();
    const { method } = c.req;
    const path = c.req.path;

    reqLogger.info({ method, path }, "request started");

    try {
      await next();
    } finally {
      const duration = Math.round(performance.now() - start);
      const status = c.res.status;

      reqLogger.info({ method, path, status, duration }, "request completed");
    }
  };
}
