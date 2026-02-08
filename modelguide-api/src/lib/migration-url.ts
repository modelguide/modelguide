/**
 * Resolves the database URL used for migrations (superuser).
 *
 * Supports:
 * - DATABASE_MIGRATION_URL as full URL (with credentials)
 * - DATABASE_MIGRATION_URL as base URL (no credentials) +
 *   DATABASE_MIGRATION_USER + DATABASE_MIGRATION_PASSWORD
 * - Fallback: DATABASE_URL
 *
 * @param env - Environment object (defaults to process.env)
 * @returns Resolved connection string, or "" if none is set
 */
export function getMigrationConnectionString(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = env.DATABASE_MIGRATION_URL;
  if (
    base &&
    env.DATABASE_MIGRATION_USER != null &&
    env.DATABASE_MIGRATION_PASSWORD != null
  ) {
    const u = new URL(base);
    if (!u.username) {
      u.username = env.DATABASE_MIGRATION_USER;
      u.password = env.DATABASE_MIGRATION_PASSWORD;
      return u.toString();
    }
  }
  return env.DATABASE_MIGRATION_URL || env.DATABASE_URL || "";
}
