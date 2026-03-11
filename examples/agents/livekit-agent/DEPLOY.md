# Deploying to LiveKit Cloud

## Prerequisites

- [lk CLI](https://docs.livekit.io/home/cli/lk/) installed
- A [LiveKit Cloud](https://cloud.livekit.io/) account
- Docker Desktop running
- All required API keys

## Steps

### 1. Authenticate

```bash
lk cloud auth login
```

### 2. Configure secrets

Set your secrets in LiveKit Cloud. The agent reads these as environment variables at runtime:

```bash
lk cloud secret set \
  OPENAI_API_KEY=sk-your-key \
  DEEPGRAM_API_KEY=your-key \
  ELEVENLABS_API_KEY=your-key \
  ELEVENLABS_VOICE_ID=iP95p4xoKVk53GoZ742B \
  MODELGUIDE_API_URL=https://modelguide-api-production.up.railway.app \
  MODELGUIDE_API_KEY=mgk_your-agent-key \
  MODELGUIDE_AGENT_ID=agt_xxx \
  USER_EMAIL=delivered+admin-glowbox@resend.dev
```

No `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` needed — LiveKit Cloud injects these automatically.

### 3. Build and push Docker image

```bash
cd examples/agents/livekit-agent
docker build -t your-registry/buildpro-livekit-agent:0.1.0 .
docker push your-registry/buildpro-livekit-agent:0.1.0
```

### 4. Deploy

```bash
lk cloud agent deploy \
  --name buildpro-sam \
  --image your-registry/buildpro-livekit-agent:0.1.0
```

### 5. Test

Create a room and dispatch an agent job:

```bash
lk room create --name test-room
lk dispatch create --agent-name buildpro-sam --room test-room
```

Or use the [LiveKit Playground](https://playground.livekit.io/) to join the room with audio.

### 6. Monitor

```bash
lk cloud agent list
lk cloud agent logs buildpro-sam
```

## Dockerfile Explained

Standard multi-stage build:

1. **Builder stage** — Uses `uv` to install Python dependencies and download the Silero VAD model
2. **Runtime stage** — Slim Python image with a non-root `agent` user

No PCC base image workarounds needed (unlike the Pipecat agent) — LiveKit Cloud runs standard Docker images.

## Connecting to ModelGuide API

The `MODELGUIDE_API_URL` must be reachable from LiveKit Cloud infrastructure. If your ModelGuide API is on Railway, use the public URL (e.g. `https://modelguide-api-production.up.railway.app`).

The agent's API key (`mgk_xxx`) must be valid and the agent must have the required connector tools assigned in the ModelGuide dashboard.
