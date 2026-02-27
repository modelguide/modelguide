---
name: railway:deploy-all
description: Deploy all ModelGuide services (API, UI, LB) to a Railway environment. Use when the user asks to "deploy all", "deploy to railway", "deploy services", "deploy everything", or "deploy all to environment".
---

# Railway Deploy All Services

Deploy all ModelGuide services to a specified Railway environment. Does NOT run database migrations.

## Inputs

Ask the user if not provided:
- **project** — Railway project name
- **environment** — Railway environment to deploy to (e.g., `demo-upgrade`, `demo`, `production`)

## Service Directory Mapping

CRITICAL — each service MUST be deployed from its specific subdirectory:

| Service | workspacePath |
|---------|--------------|
| `api`   | `<project-root>/modelguide-api` |
| `ui`    | `<project-root>/modelguide-ui` |
| `lb`    | `<project-root>/railway/lb` |

NEVER deploy from the monorepo root.

## Procedure

1. **Link to the correct project and environment** using Railway MCP `link-environment` tool:
   - workspacePath: <project-root>
   - environmentName: <environment>

2. **Deploy all three services in parallel** using Railway MCP `deploy` tool:
   - `api`: workspacePath `<project-root>/modelguide-api`, service `api`, environment `<environment>`
   - `ui`: workspacePath `<project-root>/modelguide-ui`, service `ui`, environment `<environment>`
   - `lb`: workspacePath `<project-root>/railway/lb`, service `lb`, environment `<environment>`

3. **Wait ~45 seconds** for builds to complete.

4. **Check deploy logs** using Railway MCP `get-logs` tool for all three services (logType: `deploy`, lines: 30).

5. **Report** status of each service to the user, including the LB URL: `lb-<environment>.up.railway.app`

## Notes

- This skill does NOT run database migrations. If schema changes are needed, run migrations separately.
- All deploys use the current local working directory contents (not git HEAD).
- The LB is a Caddy reverse proxy that routes to API and UI services.
