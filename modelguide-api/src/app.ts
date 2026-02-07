import { createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

import { env } from "@/env";
import { agentRoutes } from "@features/agents";
import { connectorRoutes } from "@features/connectors";
import { organizationRoutes } from "@features/organizations";
import { secretsRoutes } from "@features/secrets";
import { sessionRoutes } from "@features/sessions";
import { authRoutes, userRoutes } from "@features/users";
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

apiRouter.route("/agents", agentRoutes);
apiRouter.route("/auth", authRoutes);
apiRouter.route("/connectors", connectorRoutes);
apiRouter.route("/organizations", organizationRoutes);
apiRouter.route("/secrets", secretsRoutes);
apiRouter.route("/sessions", sessionRoutes);
apiRouter.route("/users", userRoutes);

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
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http" as const,
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT token obtained from /api/auth/verify after magic link login",
      },
    },
  },
  // biome-ignore lint/suspicious/noExplicitAny: OpenAPIObjectConfig omits `components` but we need securitySchemes for Scalar docs
} as any);

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
