# `mg` CLI — Organization Provisioning

The `mg` CLI provisions new organizations into ModelGuide from YAML configs. One command takes a directory of YAML files and sets up everything needed for a working org: users, secrets, connector instances, agents with compiled instructions and guardrails, SOPs, and optional demo sessions.

Use it for provisioning new organizations, seeding demo environments, staging rollouts, or reproducing a known-good org layout across environments (local → staging → production).

## Quick reference

```bash
cd modelguide-api

# Full setup from a YAML directory (path can be absolute or relative)
bun run src/cli/mg.ts setup /path/to/my-org/

# Dry-run — validate all YAML and print plan without touching the DB
bun run src/cli/mg.ts setup /path/to/my-org/ --dry-run

# Skip interactive secret prompts (uses placeholders — useful for testing/CI)
bun run src/cli/mg.ts setup /path/to/my-org/ --skip-secrets
```

## Setup directory layout

The setup directory needs only `org.yaml` (required). All other files are optional — omit any file and the CLI skips that step:

```
my-org/
├── org.yaml           # Required — org name, slug, metadata
├── users.yaml         # Optional — admin, support, viewer accounts
├── secrets.yaml       # Optional — encrypted credentials for connectors
├── connectors.yaml    # Optional — connector instances with config
├── agents.yaml        # Optional — agent definitions, API key generation
├── sops.yaml          # Optional — SOP templates and definitions
├── guardrails.yaml    # Optional — guardrail rules matched to SOPs at compile time
└── sessions.yaml      # Optional — demo sessions for dashboard seeding
```

Sample YAML files live in [`modelguide-api/src/cli/examples/acme/`](../../modelguide-api/src/cli/examples/acme/).

## Running against Railway

Run the CLI against a deployed Railway environment directly from your local machine:

```bash
cd modelguide-api

railway run --service api -- sh -c \
  'DATABASE_URL=postgresql://modelguide_app:$APP_DB_PASSWORD@$POSTGRES_TCP_PROXY_DOMAIN:$POSTGRES_TCP_PROXY_PORT/$PGDATABASE \
   bun run src/cli/mg.ts setup /path/to/my-org/ --skip-secrets'
```

This uses `railway run` to inject all env vars (JWT secrets, encryption key, etc.) from the selected Railway service, then overrides `DATABASE_URL` with the public TCP proxy — the private hostname isn't reachable from a local machine. Requires the TCP proxy vars documented in [DEPLOY.md step 6](../../railway/DEPLOY.md).

Pair with `--skip-secrets` for Railway runs: connector secrets should be added through the dashboard after deploy, not committed to YAML.

## Flags

| Flag | Purpose |
|---|---|
| `--dry-run` | Validate all YAML files and print the execution plan without writing to the DB |
| `--skip-secrets` | Skip interactive secret prompts (replaces with placeholder UUIDs) |
| `--skip-compile` | Skip the agent prompt compilation step |
| `--skip-sessions` | Skip demo session import |

## Individual commands

`setup` orchestrates these commands in sequence. For incremental or targeted changes, call them directly:

```bash
bun run src/cli/mg.ts create-org --from /path/to/org.yaml
bun run src/cli/mg.ts add-users --org acme --from /path/to/users.yaml
bun run src/cli/mg.ts add-secrets --org acme --from /path/to/secrets.yaml
bun run src/cli/mg.ts add-connectors --org acme --from /path/to/connectors.yaml
bun run src/cli/mg.ts add-agents --org acme --from /path/to/agents.yaml
bun run src/cli/mg.ts import-sops --org acme /path/to/sops.yaml
bun run src/cli/mg.ts import-guardrails --org acme /path/to/guardrails.yaml
bun run src/cli/mg.ts compile-agents --org acme
bun run src/cli/mg.ts import-sessions --org acme /path/to/sessions.yaml
```

## Idempotency

All provisioning commands are idempotent and safe to re-run:

- **Orgs** upsert on slug
- **Users, connectors, agents, SOPs, guardrails** — duplicate entities are skipped
- **Session imports** dedupe on `externalId` (explicit or derived from a deterministic payload hash)
- **Standalone `add-secrets`** is append-only (use `--skip-secrets` on re-runs of `setup`)

Re-running `setup` against the same directory updates any fields that changed and leaves existing data untouched.

## Design notes

The CLI is implemented as a Hono-free entry point in `modelguide-api/src/cli/mg.ts` that calls into the same services the REST API uses — no duplicate business logic. YAML files are validated with Zod schemas in `src/cli/schemas/` before any DB write. An internal `IdRegistry` tracks entities created across steps so later files can reference earlier ones by slug (e.g. agents reference connector instances and SOPs).

See [ADR-010](../decisions/010-cli-onboarding-tool.md) for the full design decisions and tradeoffs.

## See also

- [`modelguide-api/src/cli/examples/acme/`](../../modelguide-api/src/cli/examples/acme/) — sample YAML for a full org setup
- [Admin Guide](admin-guide.md) — configure orgs through the dashboard instead
- [Railway DEPLOY.md](../../railway/DEPLOY.md) — provisioning the production environment
