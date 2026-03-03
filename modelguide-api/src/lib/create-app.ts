import { OpenAPIHono } from "@hono/zod-openapi";
import { contextStorage } from "hono/context-storage";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { env } from "@/env";
import type { AppBindings } from "@/types";
import { ErrorCode, isAppError } from "@lib/errors";
import { logger } from "@lib/logger";
import { authMiddleware } from "@lib/middleware/auth";
import { requestId } from "@lib/middleware/request-id";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            code: ErrorCode.VALIDATION_ERROR,
            requestId: c.get("requestId"),
            error: result.error.flatten(),
          },
          422,
        );
      }
    },
  });
}

export function createApp() {
  const app = createRouter();

  // contextStorage → requestId must be first (other middleware may need the logger)
  app.use("*", contextStorage());
  app.use("*", requestId());

  if (env.CORS_ORIGINS) {
    const allowed = env.CORS_ORIGINS.split(",").map((s) => s.trim());
    app.use(
      "*",
      cors({
        origin: allowed,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        credentials: true,
        maxAge: 86400,
      }),
    );
  }

  app.use("*", authMiddleware());

  app.notFound((c) => {
    return c.json(
      {
        code: ErrorCode.NOT_FOUND,
        requestId: c.get("requestId"),
        message: "Not Found",
      },
      404,
    );
  });

  app.onError((err, c) => {
    if (isAppError(err)) {
      const status = err.status as ContentfulStatusCode;
      return c.json(err.toJSON(), status);
    }

    const reqLogger = c.get("logger") ?? logger;
    reqLogger.error(
      {
        err,
        method: c.req.method,
        path: c.req.path,
      },
      "unhandled error",
    );

    return c.json(
      {
        code: ErrorCode.INTERNAL_ERROR,
        requestId: c.get("requestId"),
        message:
          env.NODE_ENV === "development"
            ? err.message
            : "Internal Server Error",
      },
      500,
    );
  });

  return app;
}
