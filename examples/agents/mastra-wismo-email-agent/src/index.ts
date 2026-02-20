import { Hono } from "hono";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { webhookRouter } from "./routes/resend.webhooks.js";

const app = new Hono();

app.get("/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);

app.route("/webhook", webhookRouter);

const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

logger.info({ port: server.port }, "Mastra WISMO Email Agent running");
