---
name: mg-railway-db-restore
description: Restore a PostgreSQL database backup to a Railway environment. Use when the user asks to "restore db", "load database", "restore backup to railway", "import db", or "restore db to environment".
---

# Railway DB Restore

Restore a local PostgreSQL backup file to a Railway environment.

## Inputs

Ask the user if not provided:
- **project** — Railway project name
- **environment** — Railway destination environment name (e.g., `demo-upgrade`, `staging`)
- **backup file** — Path to the `.dump.gz` file (check `.claude/local/` for available backups)

## Procedure

1. **List available backups** (if user didn't specify a file):
   ```bash
   ls -lh <project-root>/.claude/local/*.dump.gz
   ```

2. **Link to the correct project and environment** using Railway MCP `link-environment` tool:
   - workspacePath: <project-root>
   - environmentName: <environment>

3. **Restore the backup — credentials piped from Railway CLI** (never write credential values in commands):
   ```bash
   VARS=$(railway variables -s Postgres -e <environment> --kv 2>/dev/null) && \
   export PGPASSWORD=$(echo "$VARS" | grep '^PGPASSWORD=' | cut -d= -f2-) && \
   PGUSER=$(echo "$VARS" | grep '^PGUSER=' | cut -d= -f2-) && \
   PGDATABASE=$(echo "$VARS" | grep '^PGDATABASE=' | cut -d= -f2-) && \
   DB_URL=$(echo "$VARS" | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-) && \
   PGHOST=$(echo "$DB_URL" | sed 's|postgresql://[^@]*@||;s|:.*||') && \
   PGPORT=$(echo "$DB_URL" | sed 's|.*:||;s|/.*||') && \
   gunzip -c <backup-file-path> | pg_restore --clean --if-exists --no-owner --no-acl \
     -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"
   ```

   This reads credentials from `railway variables` into shell vars at runtime — no secrets ever appear in the command text.

4. **Report** success or any errors to the user.

## Notes

- Railway runs PostgreSQL 17 — if local pg_restore version is too old, use the one from `postgresql@17` homebrew package
- `--clean --if-exists` drops existing objects before recreating (safe for existing databases)
- `--no-owner --no-acl` ensures compatibility across environments
- This does NOT run Drizzle migrations — run migrations separately if schema changes are needed
