---
name: mg-railway-db-backup
description: Backup a PostgreSQL database from a Railway environment. Use when the user asks to "backup db", "dump database", "save db from railway", "backup railway database", or "export db".
---

# Railway DB Backup

Backup a PostgreSQL database from a Railway environment to a local file.

## Inputs

Ask the user if not provided:
- **project** — Railway project name
- **environment** — Railway environment name to backup from (e.g., `demo`, `production`)

## Procedure

1. **Link to the correct project and environment** using Railway MCP `link-environment` tool:
   - workspacePath: <project-root>
   - environmentName: <environment>

2. **Ensure output directory exists:**
   ```bash
   mkdir -p <project-root>/.claude/local
   ```

3. **Run pg_dump — credentials piped from Railway CLI** (never write credential values in commands):
   ```bash
   VARS=$(railway variables -s Postgres -e <environment> --kv 2>/dev/null) && \
   export PGPASSWORD=$(echo "$VARS" | grep '^PGPASSWORD=' | cut -d= -f2-) && \
   PGUSER=$(echo "$VARS" | grep '^PGUSER=' | cut -d= -f2-) && \
   PGDATABASE=$(echo "$VARS" | grep '^PGDATABASE=' | cut -d= -f2-) && \
   DB_URL=$(echo "$VARS" | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-) && \
   PGHOST=$(echo "$DB_URL" | sed 's|postgresql://[^@]*@||;s|:.*||') && \
   PGPORT=$(echo "$DB_URL" | sed 's|.*:||;s|/.*||') && \
   pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
     --no-owner --no-acl -F c \
     | gzip > <project-root>/.claude/local/<project>-<environment>-backup-$(date +%Y%m%d-%H%M%S).dump.gz
   ```

   This reads credentials from `railway variables` into shell vars at runtime — no secrets ever appear in the command text.

4. **Verify** the backup file exists and report path + size to the user.

## Notes

- Railway runs PostgreSQL 17 — if local pg_dump version is too old, use the one from `postgresql@17` homebrew package
- Backup format is custom (`-F c`) for efficient restore with pg_restore
- `--no-owner --no-acl` strips ownership/permissions for portable restores
- Backups are stored in `.claude/local/` which is git-ignored
