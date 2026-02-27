---
name: railway:db-restore
description: Restore a PostgreSQL database backup to a Railway environment. Use when the user asks to "restore db", "load database", "restore backup to railway", "import db", or "restore db to environment".
---

# Railway DB Restore

Restore a local PostgreSQL backup file to a Railway environment.

## Inputs

Ask the user if not provided:
- **project** — Railway project name
- **environment** — Railway destination environment name (e.g., `demo-upgrade`, `staging`)
- **backup file** — Path to the `.dump` file (check `.claude/local/` for available backups)

## Procedure

1. **List available backups** (if user didn't specify a file):
   ```bash
   ls -lh <project-root>/.claude/local/*.dump
   ```

2. **Link to the correct project and environment** using Railway MCP `link-environment` tool:
   - workspacePath: <project-root>
   - environmentName: <environment>

3. **Get Postgres connection details** using Railway MCP `list-variables` tool:
   - workspacePath: <project-root>
   - service: Postgres
   - environment: <environment>
   - kv: true

   Extract `DATABASE_PUBLIC_URL` from the output.

4. **Restore the backup:**
   ```bash
   pg_restore \
     --clean --if-exists --no-owner --no-acl \
     -d "<DATABASE_PUBLIC_URL>" \
     <backup-file-path>
   ```

5. **Report** success or any errors to the user.

## Notes

- Railway runs PostgreSQL 17 — if local pg_restore version is too old, use the one from `postgresql@17` homebrew package
- `--clean --if-exists` drops existing objects before recreating (safe for existing databases)
- `--no-owner --no-acl` ensures compatibility across environments
- This does NOT run Drizzle migrations — run migrations separately if schema changes are needed
