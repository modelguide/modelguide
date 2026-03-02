---
name: mg-local-db-restore
description: Trigger phrases - "reset local db", "recreate local postgres", "restore dump to local", "reset local database", "load backup locally"
---

# Recreate Local Postgres from Dump

Reset the local Docker Postgres and restore it from a `.dump` backup file.

## Inputs

Ask the user if not provided:

- **backup file** — path to a `.dump.gz` file. If not specified, list files matching `.claude/local/*.dump.gz` and ask the user to pick one.

## Procedure

### 1. List available backups (if no file specified)

```bash
ls -lh .claude/local/*.dump.gz
```

Ask the user which backup to use.

### 2. Confirm with user

**This destroys all local database data.** Ask the user to confirm before proceeding.

### 3. Stop Postgres and remove volume

Only target the `postgres` service to avoid affecting other containers:

```bash
docker compose down -v postgres
```

### 4. Start Postgres

```bash
docker compose up -d postgres
```

### 5. Wait for healthcheck

Poll until the container is healthy (~5-10 seconds):

```bash
until docker compose ps postgres | grep -q healthy; do sleep 1; done
```

### 6. Read credentials from docker-compose.yml

Read `docker-compose.yml` at the project root and extract:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- Host port (the published port mapped to container port 5432)

**Never hardcode credentials** — always read them from the compose file.

### 7. Restore the dump

Never pass credentials in command-line arguments. Use `PGPASSWORD` as an inline env var:

```bash
gunzip -c <backup-file> | PGPASSWORD=<password> pg_restore --clean --if-exists --no-owner --no-acl \
  -h localhost -p <port> -U <user> -d <db>
```

### 8. Verify restoration

Query `pg_tables` via psql to confirm tables exist:

```bash
PGPASSWORD=<password> psql -h localhost -p <port> -U <user> -d <db> \
  -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
```

Report the table count and list to the user.

### 9. Report success

Tell the user the restore is complete. Remind them:

- Run `make db-migrate` if the dump may be behind on migrations
- Run `make db-seed` if they need fresh seed data on top of the backup

## Notes

- Docker compose file is at the project root (`docker-compose.yml`)
- The `init.sql` script automatically creates the `modelguide_app` role on a fresh volume, so the restore should work without manual role creation
- If `pg_restore` reports errors about missing roles or permissions, these are usually safe to ignore with `--no-owner --no-acl`
