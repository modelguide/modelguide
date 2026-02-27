---
name: railway:db-backup
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

2. **Get Postgres connection details** using Railway MCP `list-variables` tool:
   - workspacePath: <project-root>
   - service: Postgres
   - environment: <environment>
   - kv: true

   Extract `DATABASE_PUBLIC_URL` from the output.

3. **Ensure output directory exists:**
   ```bash
   mkdir -p <project-root>/.claude/local
   ```

4. **Run pg_dump:**
   ```bash
   pg_dump "<DATABASE_PUBLIC_URL>" \
     --no-owner --no-acl -F c \
     -f <project-root>/.claude/local/<project>-<environment>-backup-$(date +%Y%m%d-%H%M%S).dump
   ```

5. **Verify** the backup file exists and report path + size to the user.

## Notes

- Railway runs PostgreSQL 17 — if local pg_dump version is too old, use the one from `postgresql@17` homebrew package
- Backup format is custom (`-F c`) for efficient restore with pg_restore
- `--no-owner --no-acl` strips ownership/permissions for portable restores
- Backups are stored in `.claude/local/` which is git-ignored
