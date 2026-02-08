#!/usr/bin/env bash
set -euo pipefail

# Railway DB reset + migrate + seed
# Usage: railway run bash scripts/railway-db-reset.sh
#   or:  DATABASE_MIGRATION_URL=... DATABASE_APP_PASSWORD=... bash scripts/railway-db-reset.sh

if [ -z "${DATABASE_MIGRATION_URL:-}" ]; then
  echo "ERROR: DATABASE_MIGRATION_URL is not set" >&2
  exit 1
fi

if [ -z "${DATABASE_APP_PASSWORD:-}" ]; then
  echo "ERROR: DATABASE_APP_PASSWORD is not set" >&2
  exit 1
fi

# Safety gate for interactive use (skipped in CI)
if [ -t 0 ] && [ "${CI:-}" != "true" ]; then
  read -rp "This will DROP the entire public schema. Type 'yes' to continue: " confirm
  [ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }
fi

echo "==> Dropping and recreating schemas..."
psql "$DATABASE_MIGRATION_URL" -c "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "==> Ensuring modelguide_app role exists..."
psql "$DATABASE_MIGRATION_URL" -v app_password="$DATABASE_APP_PASSWORD" -f scripts/railway-db-init.sql 2>/dev/null || true

echo "==> Running Drizzle migrations..."
cd modelguide-api
DATABASE_URL="$DATABASE_MIGRATION_URL" bunx drizzle-kit migrate

echo "==> Re-granting table/sequence privileges..."
psql "$DATABASE_MIGRATION_URL" <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modelguide_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modelguide_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modelguide_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO modelguide_app;
SQL

echo "==> Running seed..."
bun run src/db/seed/index.ts

echo "==> Done! Database has been reset, migrated, and seeded."
