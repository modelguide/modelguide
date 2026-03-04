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

If the project and services already exist, link each one from its directory:

```bash
(cd modelguide-api && railway link --service api)
(cd modelguide-ui && railway link --service ui)
(cd railway/lb && railway link --service lb)
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
  --set LOG_LEVEL=info \
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

## 6. Migrate and seed database (one-time)

`railway run` executes locally, so the DB needs a public endpoint. Railway
enables TCP proxy on Postgres by default. Link the proxy vars (including
`PGDATABASE`) to the api service:

```bash
railway variables \
  --set 'POSTGRES_TCP_PROXY_DOMAIN=${{Postgres.RAILWAY_TCP_PROXY_DOMAIN}}' \
  --set 'POSTGRES_TCP_PROXY_PORT=${{Postgres.RAILWAY_TCP_PROXY_PORT}}' \
  --set 'PGDATABASE=${{Postgres.PGDATABASE}}' \
  --service api
```

Run the migration first (provisions the `modelguide_app` role and runs Drizzle
migrations), then seed. Both commands override `DATABASE_MIGRATION_URL` to use
the TCP proxy. Credentials come from `DATABASE_MIGRATION_USER` and
`DATABASE_MIGRATION_PASSWORD` set in step 3 (used internally by
`getMigrationConnectionString()`). `APP_DB_PASSWORD` (also from step 3)
provisions the app role.

```bash
# Migrate (provisions roles + runs Drizzle migrations)
railway run --service api -- sh -c 'cd modelguide-api && \
  DATABASE_MIGRATION_URL=postgresql://$POSTGRES_TCP_PROXY_DOMAIN:$POSTGRES_TCP_PROXY_PORT/$PGDATABASE \
  bun run scripts/migrate.ts'

# Seed
railway run --service api -- sh -c 'cd modelguide-api && \
  DATABASE_MIGRATION_URL=postgresql://$POSTGRES_TCP_PROXY_DOMAIN:$POSTGRES_TCP_PROXY_PORT/$PGDATABASE \
  bun run src/db/seed/index.ts'
```

## 7. Assign public domain

```bash
railway domain --service lb
```

Only Caddy gets a public domain. It routes:
- `/api/*`, `/docs`, `/docs/*`, `/openapi.json`, `/mcp/*`, `/webhooks/*` → `api.railway.internal:8080`
- Everything else → `ui.railway.internal:8080`

The UI uses a relative `/api` prefix — no `VITE_API_URL` needed.

## 8. Set domain-dependent variables

These variables require the public domain assigned in step 7. Setting them
triggers an automatic API redeploy on Railway.

```bash
railway variables \
  --set 'APP_URL=https://<your-lb-domain>.up.railway.app' \
  --set 'MAGIC_LINK_STRATEGY=resend' \
  --set 'RESEND_API_KEY=re_xxxxxxxxxxxx' \
  --set 'RESEND_FROM_EMAIL=noreply@yourdomain.com' \
  --service api
```

- `APP_URL` — public domain (from step 7). Used for CSRF origin validation and magic link URLs
- `MAGIC_LINK_STRATEGY=resend` — switches from `console` (dev) to Resend email delivery
- `RESEND_API_KEY` — Resend API key
- `RESEND_FROM_EMAIL` — sender address (must be verified in Resend)

Optional:

- `API_EXTERNAL_ADDRESS` — public API URL for ElevenLabs/webhook sync (falls back to `APP_URL`)
- `SIMULATION_LLM_API_KEY` — OpenAI (or compatible) API key for persona simulation
- `SIMULATION_LLM_BASE_URL` — custom base URL for OpenAI-compatible endpoint (defaults to OpenAI). For Claude, set to `https://api.anthropic.com/v1/`
- `SIMULATION_LLM_MODEL` — model to use for simulation (defaults to `gpt-5-mini`). For Claude, use e.g. `claude-sonnet-4-6`

## 9. Verify

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
