---
name: mg-railway-deploy-all
description: Deploy all ModelGuide services (API, UI, LB) to a Railway environment. Use when the user asks to "deploy all", "deploy to railway", "deploy services", "deploy everything", or "deploy all to environment".
---

# Railway Deploy All Services

Deploy all ModelGuide services to a specified Railway environment. Does NOT run database migrations.

## Inputs

Ask the user if not provided:
- **project** — Railway project name
- **environment** — Railway environment to deploy to (e.g., `demo-upgrade`, `demo`, `production`)

## Deployment Rules

CRITICAL — ALL services MUST be deployed from the **monorepo root** (`<project-root>`), NOT from subdirectories. Railway's `railway.toml` in each service directory already specifies the root directory for the build. Deploying from a subdirectory doubles the path and causes "Could not find root directory" errors.

## Procedure

1. **Link to the correct project and environment** — either via Railway MCP `link-environment` tool or `railway link`:
   - workspacePath: `<project-root>` (monorepo root)
   - environmentName: `<environment>`

2. **Deploy services from the monorepo root** using `railway up --service <name>`:
   ```bash
   cd <project-root>
   railway up --service api
   railway up --service ui
   railway up --service lb
   ```
   If Railway MCP tools are available, use the `deploy` tool with `workspacePath: <project-root>` for all services.
   Deploy all requested services in parallel when possible.

3. **Wait ~45 seconds** for builds to complete.

4. **Check deploy logs** using `railway logs --service <name> --deployment` or Railway MCP `get-logs` tool for each service.

5. **Report** status of each service to the user, including the LB URL: `lb-<environment>.up.railway.app`

## Notes

- This skill does NOT run database migrations. If schema changes are needed, run migrations separately.
- All deploys use the current local working directory contents (not git HEAD).
- The LB is a Caddy reverse proxy that routes to API and UI services.
