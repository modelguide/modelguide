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
process.env.ANTHROPIC_API_KEY = "test-anthropic-api-key";
process.env.GENERATION_DIMENSION_MODEL = "claude-sonnet-4-20250514";
process.env.GENERATION_CASE_MODEL = "claude-haiku-4-5-20251001";
