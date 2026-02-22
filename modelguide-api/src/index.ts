import { env } from "@/env";
import { closeDatabase } from "@db/index";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import app from "./app";

await loadAllManifests();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`Server running at http://localhost:${server.port}`);
console.log(`API docs available at http://localhost:${server.port}/docs`);

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down...");
  await closeDatabase();
  server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
