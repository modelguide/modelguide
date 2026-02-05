import { createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

import { env } from "@/env";
import { authRoutes } from "@features/users";
import { createApp, createRouter } from "@lib/create-app";

// Health check route
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

// Create API router
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

// Mount auth routes
apiRouter.route("/auth", authRoutes);

// Create main app
const app = createApp();

// Mount API routes under /api
app.route("/api", apiRouter);

// OpenAPI spec
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

// Scalar API documentation
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

// MCP endpoint placeholder
app.post("/mcp", async (c) => {
  // MCP server implementation will be added in the mcp feature module
  return c.json({ message: "MCP endpoint - implementation pending" }, 501);
});

export default app;
