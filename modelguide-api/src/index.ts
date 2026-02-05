import { env } from "@/env";
import { closeDatabase } from "@db/index";
import app from "./app";

const server = Bun.serve({
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
