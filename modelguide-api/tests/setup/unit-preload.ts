/**
 * Bun preload script for unit tests.
 *
 * Sets fake env vars so that src/env.ts validation passes.
 * No real database connection is made — the DATABASE_URL is a dummy.
 *
 * Usage: bun test --preload ./tests/setup/unit-preload.ts tests/unit
 */

process.env.DATABASE_URL = "postgresql://fake:fake@localhost:5432/fake";
process.env.JWT_SECRET =
  "test-jwt-secret-that-is-at-least-32-characters-long";
process.env.ENCRYPTION_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef",
).toString("base64");
process.env.APP_URL = "http://localhost:3000";
