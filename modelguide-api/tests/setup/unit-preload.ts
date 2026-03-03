/**
 * Bun preload script for unit tests.
 *
 * Sets fake env vars so that src/env.ts validation passes.
 * No real database connection is made — the DATABASE_URL is a dummy.
 *
 * Usage: bun test --preload ./tests/setup/unit-preload.ts tests/unit
 */

process.env.DATABASE_URL = "postgresql://fake:fake@localhost:5432/fake";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env.REFRESH_JWT_SECRET =
  "test-refresh-jwt-secret-at-least-32-chars-long";
process.env.ENCRYPTION_KEY = "test-encryption-key-at-least-32-characters-long";
process.env.APP_URL = "http://localhost:3000";
process.env.MAGIC_LINK_SECRET =
  "test-magic-link-secret-that-is-at-least-32-characters-long";
process.env.LOG_LEVEL = "silent";
