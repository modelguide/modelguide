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
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID
MODELGUIDE_API_URL        # e.g. https://modelguide-api-production.up.railway.app
MODELGUIDE_API_KEY         # mgk_xxx agent API key
MODELGUIDE_AGENT_ID        # agt_xxx agent ID
USER_EMAIL                 # e.g. delivered+admin-glowbox@resend.dev
```

No `DAILY_API_KEY` needed when using `--enable-managed-keys`.

### 3. Build and push Docker image

```bash
cd examples/agents/pipecat-agent
echo Y | pipecat cloud docker build-push buildpro-agent -v 0.17.7 -r dockerhub -u YOUR_DOCKERHUB_USER
```

### 4. Deploy

```bash
pipecat cloud deploy buildpro-agent YOUR_DOCKERHUB_USER/buildpro-agent:0.17.7 \
  -s my-secrets -min 1 --enable-managed-keys -nc -f
```

The CLI may report a 90-second timeout — this is normal. Check status separately:

```bash
pipecat cloud agent status buildpro-agent
pipecat cloud agent logs buildpro-agent
```

Look for `Health: Ready` and `BuildPro Sam agent vX.Y.Z starting` in the logs.

### 5. Test

```bash
pipecat cloud agent start buildpro-agent -f -D
```

### 6. Stop billing

```bash
pipecat cloud agent delete buildpro-agent -f
```

## Dockerfile Explained

The PCC base image (`dailyco/pipecat-base:latest`) uses **0-byte stubs** for Python, pip, uv, and all pre-installed `.py`/`.so` files. PCC injects real binaries at deploy time. This means `RUN pip install` during `docker build` is a silent no-op.

We use a multi-stage build to work around this:

```dockerfile
# Stage 1: Real Python installs real packages
FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim AS builder
WORKDIR /deps
COPY requirements.txt .
RUN uv venv /deps/.venv && \
    uv pip install --python /deps/.venv/bin/python --no-cache -r requirements.txt

# Stage 2: Merge into PCC base image
FROM dailyco/pipecat-base:latest
COPY --from=builder /deps/.venv/lib/python3.12/site-packages/ /app/.venv/lib/python3.12/site-packages/
COPY requirements.txt requirements.txt
COPY src/ .
```

### Important: Version Pins

The base image has specific versions of `starlette` (0.50.0) and `uvicorn` (0.40.0) that PCC's fastapi health check server depends on. Our COPY overwrites these, so `requirements.txt` must pin them to matching versions:

```
starlette==0.50.0
uvicorn==0.40.0
```

Without these pins, newer versions get installed and break PCC's health check (causing `ValidationTimeout` on deploy).

### Important: daily-python

`daily-python` is included in the build (via `pipecat-ai[daily,...]`). Do NOT uninstall it from the builder stage — PCC's runtime injection of daily-python is unreliable.

## Connecting to ModelGuide API

The `MODELGUIDE_API_URL` must be reachable from Pipecat Cloud's infrastructure. If your ModelGuide API is on Railway, use the public URL (e.g. `https://modelguide-api-production.up.railway.app`).

The agent's API key (`mgk_xxx`) must be valid and the agent must have the required connector tools assigned in the ModelGuide dashboard.
