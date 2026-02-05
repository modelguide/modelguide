import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // Use migration URL (superuser) so tables are owned by migration user
    // App uses DATABASE_URL (modelguide_app) which is subject to RLS
    url: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL!,
  },
});
