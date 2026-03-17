# Deploying to Pipecat Cloud

## Prerequisites

- [Pipecat Cloud CLI](https://docs.pipecat.ai/deployment/pipecat-cloud/introduction) installed (`pip install pipecatcloud`)
- A Pipecat Cloud account
- Docker Desktop running
- A Docker Hub account (or other container registry)
- All required API keys

## Steps

### 1. Authenticate

```bash
pipecat cloud auth login
```

### 2. Configure secrets

Create a secret set in Pipecat Cloud with your API keys:

```
OPENAI_API_KEY
DEEPGRAM_API_KEY
CARTESIA_API_KEY
TTS_PROVIDER=cartesia
MODELGUIDE_API_URL        # e.g. https://modelguide-api-production.up.railway.app
MODELGUIDE_API_KEY         # mgk_xxx agent API key
MODELGUIDE_AGENT_ID        # agt_xxx agent ID
USER_EMAIL                 # e.g. delivered+admin-glowbox@resend.dev

# Optional: Langfuse observability
LANGFUSE_PUBLIC_KEY        # pk-lf-xxx
LANGFUSE_SECRET_KEY        # sk-lf-xxx
LANGFUSE_HOST              # https://cloud.langfuse.com (default)
```

### 3. Build and push Docker image

```bash
cd examples/agents/pipecat-agent
echo Y | pipecat cloud docker build-push buildpro-agent -v 0.23.0 -r dockerhub -u YOUR_DOCKERHUB_USER
```

### 4. Deploy

```bash
pipecat cloud deploy buildpro-agent YOUR_DOCKERHUB_USER/buildpro-agent:0.23.0 \
  -s my-secrets -min 1 -nc -f
```

Or update `pcc-deploy.toml` and run:

```bash
pipecat cloud deploy
```

Check status:

```bash
pipecat cloud agent status buildpro-agent
pipecat cloud agent logs buildpro-agent
```

Look for `Health: Ready` and `BuildPro Sam agent v0.23.0 starting` in the logs.

### 5. Test

```bash
pipecat cloud agent start buildpro-agent -f -D
```

### 6. Stop billing

```bash
pipecat cloud agent delete buildpro-agent -f
```

## Dockerfile

The PCC base image (`dailyco/pipecat-base:latest`) is built from `ghcr.io/astral-sh/uv:python3.12-trixie-slim` with real Python, uv, and pip. Dependencies are installed at container startup via `pre-app.sh` using `uv sync`:

```dockerfile
FROM dailyco/pipecat-base:latest

COPY pyproject.toml uv.lock pre-app.sh ./
COPY src/ .
```

The `pre-app.sh` script runs before `app.py` (built into the PCC base image CMD) and installs dependencies using `uv sync --locked --no-install-project --no-dev`. This ensures packages match the runtime environment exactly.

After changing dependencies in `pyproject.toml`, regenerate the lockfile:

```bash
uv lock
```

## Observability (Langfuse)

When `LANGFUSE_PUBLIC_KEY` is set, the agent exports OpenTelemetry traces to Langfuse. Each voice session produces a trace with per-turn spans for STT, LLM, and TTS including TTFB, token usage, and transcripts.

## Multi-Region Deployment

Deploy to EU with a separate agent name and secret set:

```bash
# Build for EU
echo Y | pipecat cloud docker build-push buildpro-agent-eu -v 0.23.0 -r dockerhub -u YOUR_DOCKERHUB_USER

# Deploy
pipecat cloud deploy buildpro-agent-eu YOUR_DOCKERHUB_USER/buildpro-agent-eu:0.23.0 \
  -s my-secrets-eu -min 1 -nc -f
```

Each region needs its own secret set (e.g. `my-secrets-eu`). Create one with `pipecat cloud secrets create my-secrets-eu`.

### Known Issues

- **Don't use `--enable-managed-keys`** — causes deploy timeouts. Include `DAILY_API_KEY` in your secret set if needed.
- **Rapid deploy/delete cycles** can cause PCC to stop scheduling containers silently. If stuck on "Stopped", delete the agent, wait 30+ seconds, then redeploy.

## Connecting to ModelGuide API

The `MODELGUIDE_API_URL` must be reachable from Pipecat Cloud's infrastructure. If your ModelGuide API is on Railway, use the public URL (e.g. `https://modelguide-api-production.up.railway.app`).

The agent's API key (`mgk_xxx`) must be valid and the agent must have the required connector tools assigned in the ModelGuide dashboard.
