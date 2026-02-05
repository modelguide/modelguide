import { OpenAPIHono } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AppBindings } from "@/types";
import { ErrorCode, isAppError } from "@lib/errors";
import { authMiddleware } from "@lib/middleware/auth";
import { rlsMiddleware } from "@lib/middleware/rls";

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

  // Apply authentication middleware globally
  app.use("*", authMiddleware());

  // Apply RLS middleware after auth (requires organizationId from auth)
  app.use("*", rlsMiddleware());

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
    // Handle AppError instances
    if (isAppError(err)) {
      const status = err.status as ContentfulStatusCode;
      return c.json(err.toJSON(), status);
    }

    // Log unexpected errors
    console.error("Unhandled error:", err);

    // Return generic error for unknown errors
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
