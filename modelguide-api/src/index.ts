import { env } from "@/env";
import { closeDatabase } from "@db/index";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { syncCatalogAndTools } from "@features/connectors/catalog/sync-tools";
import { destination, logger } from "@lib/logger";
import app from "./app";

await loadAllManifests();
await syncCatalogAndTools();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: env.PORT,
  fetch: app.fetch,
});

logger.info({ port: server.port }, "server running");
logger.info(
  { url: `http://localhost:${server.port}/docs` },
  "API docs available",
);

// Graceful shutdown
const shutdown = async () => {
  logger.info("shutting down");
  destination?.flushSync();
  await closeDatabase();
  server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Safety net for truly unhandled errors — log and exit
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection — shutting down");
  destination?.flushSync();
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — shutting down");
  destination?.flushSync();
  process.exit(1);
});
