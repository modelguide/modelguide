import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { env } from "@/env";
import type { AppBindings } from "@/types";
import { ErrorCode, isAppError } from "@lib/errors";
import { authMiddleware } from "@lib/middleware/auth";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            code: ErrorCode.VALIDATION_ERROR,
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

    console.error("Unhandled error:", err);

    return c.json(
      {
        code: ErrorCode.INTERNAL_ERROR,
        message:
          process.env.NODE_ENV === "development"
            ? err.message
            : "Internal Server Error",
      },
      500,
    );
  });

  return app;
}
