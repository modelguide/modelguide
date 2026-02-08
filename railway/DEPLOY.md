# Railway Deployment

## Prerequisites

```bash
brew install railway    # or: npm i -g @railway/cli
railway login
```

## 1. Create project and link

```bash
railway init
railway link
```

## 2. Add services

```bash
railway add --database postgres
railway add --service api
railway add --service ui
railway add --service lb
```

Service names **must** be exactly `api`, `ui`, `lb` — the Caddyfile
references `api.railway.internal` and `ui.railway.internal`.

## 3. Set API variables

```bash
railway variables \
  --set 'DATABASE_URL=postgresql://modelguide_app:${{APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}' \
  --set 'DATABASE_MIGRATION_URL=postgresql://${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}' \
  --set 'DATABASE_MIGRATION_USER=${{Postgres.PGUSER}}' \
  --set 'DATABASE_MIGRATION_PASSWORD=${{Postgres.PGPASSWORD}}' \
  --set "APP_DB_PASSWORD=$(openssl rand -hex 24)" \
  --set "JWT_SECRET=$(openssl rand -hex 32)" \
  --set "REFRESH_JWT_SECRET=$(openssl rand -hex 32)" \
  --set "ENCRYPTION_KEY=$(openssl rand -hex 32)" \
  --set "MAGIC_LINK_SECRET=$(openssl rand -hex 32)" \
  --set NODE_ENV=production \
  --service api
```

## 4. Set UI variables

```bash
railway variables \
  --set NODE_ENV=production \
  --service ui
```

## 5. Deploy services

From the repo root:

```bash
# API — railway.toml handles Dockerfile, pre-deploy migrations, healthcheck
(cd modelguide-api && railway up --service api)

# UI — railway.toml handles Dockerfile
(cd modelguide-ui && railway up --service ui)

# Load balancer — deploy from railway/lb/
(cd railway/lb && railway up --service lb)
```

## 6. Seed database (one-time)

`railway run` executes locally, so the DB needs a public endpoint. Railway
enables TCP proxy on Postgres by default. Link the proxy vars to the api
service:

```bash
railway variables --set 'POSTGRES_TCP_PROXY_DOMAIN=${{Postgres.RAILWAY_TCP_PROXY_DOMAIN}}' --set 'POSTGRES_TCP_PROXY_PORT=${{Postgres.RAILWAY_TCP_PROXY_PORT}}' --service api
```

Run the seed, overriding `DATABASE_MIGRATION_URL` to use the proxy host/port (keeps
DATABASE_MIGRATION_USER and DATABASE_MIGRATION_PASSWORD from step 3):

```bash
railway run --service api -- sh -c 'cd modelguide-api && DATABASE_MIGRATION_URL=postgresql://$POSTGRES_TCP_PROXY_DOMAIN:$POSTGRES_TCP_PROXY_PORT/railway bun run src/db/seed/index.ts'
```

## 7. Assign public domain

```bash
railway domain --service lb
```

Only Caddy gets a public domain. It routes:
- `/api/*`, `/docs`, `/mcp` → `api.railway.internal:8080`
- Everything else → `ui.railway.internal:8080`

The UI uses a relative `/api` prefix — no `VITE_API_URL` needed.

## 8. Verify

```bash
railway logs --service api --follow
railway logs --service lb --follow
railway status
```

## Operations

```bash
railway logs --follow                # stream logs (linked service)
railway logs --service api --follow  # stream logs (specific service)
railway variables --service api      # list variables
railway status                       # project info
```

## Config-as-code files

| File | Purpose |
|---|---|
| `modelguide-api/railway.toml` | API build, pre-deploy migrations, healthcheck, restart policy |
| `modelguide-ui/railway.toml` | UI build, restart policy |
| `railway/lb/railway.toml` | Load balancer build, restart policy |
| `railway/lb/Dockerfile` | Caddy image with Caddyfile |
| `railway/lb/Caddyfile` | Routes traffic to API and UI via internal domains |

## Template (one-click deploy)

Template creation is Dashboard-only:

1. `railway open` — opens project in browser
2. Project Settings → Generate Template from Project
3. Replace hardcoded secrets with `${{secret()}}` functions (see README)
4. Publish and update the deploy button URL in the README
