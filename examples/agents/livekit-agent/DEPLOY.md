# Deploying to LiveKit Cloud

## Prerequisites

- [lk CLI](https://docs.livekit.io/home/cli/lk/) installed and authenticated
- A [LiveKit Cloud](https://cloud.livekit.io/) project
- All required API keys (OpenAI, Deepgram, ElevenLabs or Cartesia, ModelGuide)

## Deployment Architecture

```
EEA User ←WebRTC→ LiveKit Edge (EU) ←relay→ LiveKit Agent (eu-central)
                                                ├── Deepgram STT (US)
                                                ├── OpenAI LLM (US)
                                                ├── Cartesia TTS (US)
                                                └── ModelGuide API (Railway)
```

LiveKit's global edge network connects users to the nearest edge node via WebRTC. The edge node relays media to the agent — users never experience cross-region latency directly. All inference services (STT, LLM, TTS) and the ModelGuide API should be co-located in the same region as the agent to minimize the voice pipeline latency.

## Steps

### 1. Authenticate

```bash
lk cloud auth login
```

### 2. Set secrets

```bash
lk agent update-secrets \
  OPENAI_API_KEY=sk-your-key \
  LLM_MODEL=gpt-4.1-mini \
  DEEPGRAM_API_KEY=your-key \
  CARTESIA_API_KEY=your-key \
  CARTESIA_VOICE_ID=your-voice-id \
  TTS_PROVIDER=cartesia \
  MODELGUIDE_API_URL=https://your-modelguide-api.up.railway.app \
  MODELGUIDE_API_KEY=mgk_your-agent-key \
  MODELGUIDE_AGENT_ID=your-agent-uuid \
  USER_EMAIL=delivered+admin-glowbox@resend.dev

# Optional: Langfuse observability (omit to disable)
# NOTE: Never set debug=True in the Langfuse SDK — it causes ~2s+ latency
# per turn due to synchronous logging on every span export. With debug off,
# tracing adds negligible overhead.
lk agent update-secrets \
  LANGFUSE_PUBLIC_KEY=pk-lf-your-key \
  LANGFUSE_SECRET_KEY=sk-lf-your-key \
  LANGFUSE_HOST=https://cloud.langfuse.com
```

No `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` needed — LiveKit Cloud injects these automatically.

### 3. Create and deploy

The `lk` CLI builds the Docker image remotely and deploys it:

```bash
cd examples/agents/livekit-agent
lk agent create --region eu-central -y
```

This creates a `livekit.toml` linking your directory to the cloud agent. Subsequent deploys:

```bash
lk agent deploy
```

### 4. Verify

```bash
lk agent list                    # Check deployment status
lk agent status                  # Detailed status (CPU, memory, replicas)
lk agent logs                    # Tail startup logs
```

### 5. Test

Create a token with agent dispatch and open the LiveKit Meet playground:

```bash
lk token create --room test-room --identity user --join --valid-for 1h --agent buildpro-sam --open meet
```

This opens `meet.livekit.io` with the token pre-filled. Allow microphone access — Sam will greet you automatically.

## Useful commands

```bash
lk agent versions                # List deployed versions
lk agent rollback                # Roll back to previous version
lk agent update-secrets          # Update secrets (triggers restart)
lk agent restart                 # Restart without redeploying
lk agent delete                  # Remove the agent
lk agent logs                    # Tail logs (streaming)
```

## Dockerfile

Multi-stage build:

1. **Builder stage** — Uses `uv` to install Python dependencies, downloads Silero VAD and turn detector models into a shared HF cache
2. **Runtime stage** — Slim Python image with a non-root `agent` user, HF model cache copied from builder

No custom base image needed — LiveKit Cloud runs standard Docker images.
