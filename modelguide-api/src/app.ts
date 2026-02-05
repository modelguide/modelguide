import { createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

import { env } from "@/env";
import { authRoutes } from "@features/users";
import { createApp, createRouter } from "@lib/create-app";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: {
      description: "Health check response",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
  },
});

const apiRouter = createRouter();

apiRouter.openapi(healthRoute, (c) => {
  return c.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    200,
  );
});

apiRouter.route("/auth", authRoutes);

const app = createApp();
app.route("/api", apiRouter);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "ModelGuide API",
    version: "0.1.0",
    description: "API for ModelGuide - AI Agent Management Platform",
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: "Development server",
    },
  ],
});

app.get(
  "/docs",
  apiReference({
    spec: {
      url: "/openapi.json",
    },
    theme: "kepler",
    layout: "modern",
    pageTitle: "ModelGuide API",
  }),
);

app.post("/mcp", async (c) => {
  return c.json({ message: "MCP endpoint - implementation pending" }, 501);
});

export default app;
