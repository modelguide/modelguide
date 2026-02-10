import { createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

import { env } from "@/env";
import { agentRoutes } from "@features/agents";
import { analyticsRoutes } from "@features/analytics";
import { connectorRoutes } from "@features/connectors";
import { demoRoutes } from "@features/demo";
import { feedbackRoutes } from "@features/feedback";
import { mcpHandler } from "@features/mcp";
import { organizationRoutes } from "@features/organizations";
import { secretsRoutes } from "@features/secrets";
import { sessionRoutes } from "@features/sessions";
import { authRoutes, userRoutes } from "@features/users";
import { elevenlabsWebhooks } from "@features/webhooks";
import { createApp, createRouter } from "@lib/create-app";
import { rateLimit } from "@lib/middleware";

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
apiRouter.route("/analytics", analyticsRoutes);
apiRouter.use("/auth/*", rateLimit({ limit: 10, windowSeconds: 60 }));
apiRouter.route("/auth", authRoutes);
apiRouter.route("/connectors", connectorRoutes);
apiRouter.route("/organizations", organizationRoutes);
apiRouter.route("/secrets", secretsRoutes);
apiRouter.route("/sessions", sessionRoutes);
apiRouter.route("/sessions", feedbackRoutes); // sub-resource: /:id/feedback
apiRouter.route("/users", userRoutes);

// Config endpoint (always available — returns demoMode flag)
const configRoute = createRoute({
  method: "get",
  path: "/config",
  tags: ["Config"],
  summary: "Get public config",
  responses: {
    200: {
      description: "Public configuration",
      content: {
        "application/json": {
          schema: z.object({ demoMode: z.boolean() }),
        },
      },
    },
  },
});

apiRouter.openapi(configRoute, (c) => {
  return c.json({ demoMode: env.DEMO_MODE_ENABLED === true }, 200);
});

// Demo routes (conditionally mounted)
if (env.DEMO_MODE_ENABLED) {
  apiRouter.route("/", demoRoutes);
}

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

app.route("/webhooks/elevenlabs", elevenlabsWebhooks);

// MCP endpoint — separate from API router (different protocol, not REST)
// Agent ID in path for explicit routing; API key in header for auth verification.
app.on(["POST", "GET", "DELETE"], "/mcp/:agentId", mcpHandler);

export default app;
