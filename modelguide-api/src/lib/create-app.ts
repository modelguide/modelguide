import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";

import type { AppBindings } from "@/types";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error.flatten(),
          },
          422
        );
      }
    },
  });
}

export function createApp() {
  const app = createRouter();

  app.notFound((c) => {
    return c.json({ message: "Not Found" }, 404);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json(
      {
        message: err.message || "Internal Server Error",
      },
      500
    );
  });

  return app;
}
