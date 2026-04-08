# Deploying to LiveKit Cloud

## Prerequisites

- [lk CLI](https://docs.livekit.io/home/cli/lk/) installed and authenticated
- A [LiveKit Cloud](https://cloud.livekit.io/) project
- All required API keys (OpenAI, Deepgram, ElevenLabs or Cartesia, ModelGuide)

## Deployment Architecture

```
Phone (PSTN) ──→ LiveKit Phone Number ──→┐
Browser ←WebRTC→ LiveKit Edge (nearest) ─┤
                                         ↕
                                    LiveKit Agent (eu-central)
                                      ├── Deepgram STT (US)
                                      ├── OpenAI LLM (US)
                                      ├── ElevenLabs / Cartesia TTS (US)
                                      ├── ModelGuide API (Railway)
                                      └── Twilio SIP Trunk (outbound calls)
```

LiveKit's global edge network connects users to the nearest edge node via WebRTC. The edge node relays media to the agent — users never experience cross-region latency directly. All inference services (STT, LLM, TTS) and the ModelGuide API should be co-located in the same region as the agent to minimize the voice pipeline latency.

### Region planning

The agent is currently deployed to `eu-central`. Without Enterprise plans, all inference providers route through US endpoints, so the agent makes cross-Atlantic calls on every STT→LLM→TTS hop.

**Recommended next steps:**

1. **Move agent to `us-east`** — co-locate with inference providers to eliminate cross-Atlantic latency. LiveKit's edge network still serves EU users with low WebRTC latency.
2. **Move ModelGuide API to US** — co-locate with the agent (e.g. Railway `us-east`).
3. Region should be a deployment parameter, not hardcoded — pick based on where your inference providers live.

### Provider EU data residency

| Provider | EU available | Requirement |
|----------|-------------|-------------|
| OpenAI | Yes | Enterprise plan |
| ElevenLabs | Yes | Enterprise plan |
| Deepgram | Yes | None (`api-eu.deepgram.com`) |
| Cartesia | No | US-only |

Without Enterprise plans for OpenAI and ElevenLabs, an EU-hosted agent still sends inference traffic to US — adding ~100ms per provider hop compared to a US-hosted agent.

## Steps

### 1. Authenticate

```bash
lk cloud auth login
```

### 2. Set secrets

Core secrets (required):

```bash
lk agent update-secrets \
  OPENAI_API_KEY=sk-your-key \
  LLM_MODEL=gpt-4.1-mini \
  DEEPGRAM_API_KEY=your-key \
  MODELGUIDE_API_URL=https://your-modelguide-api.up.railway.app \
  MODELGUIDE_API_KEY=mgk_your-agent-key \
  MODELGUIDE_AGENT_ID=your-agent-uuid \
  USER_EMAIL=delivered+admin-glowbox@resend.dev
```

TTS provider — pick **one** of the two options:

**Option A: ElevenLabs (default)**

```bash
lk agent update-secrets \
  TTS_PROVIDER=elevenlabs \
  ELEVENLABS_API_KEY=your-key \
  ELEVENLABS_VOICE_ID=your-voice-id
```

**Option B: Cartesia**

```bash
lk agent update-secrets \
  TTS_PROVIDER=cartesia \
  CARTESIA_API_KEY=your-key \
  CARTESIA_VOICE_ID=your-voice-id
```

Optional — Langfuse observability (omit to disable):

```bash
# NOTE: Never set debug=True in the Langfuse SDK — it causes ~2s+ latency
# per turn due to synchronous logging on every span export. With debug off,
# tracing adds negligible overhead.
lk agent update-secrets \
  LANGFUSE_PUBLIC_KEY=pk-lf-your-key \
  LANGFUSE_SECRET_KEY=sk-lf-your-key \
  LANGFUSE_HOST=https://cloud.langfuse.com
```

Optional — SIP / Telephony (omit if not using phone calls):

```bash
lk agent update-secrets \
  SIP_OUTBOUND_TRUNK_ID=ST_xxxx
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

**WebRTC (browser)** — create a token with agent dispatch and open the LiveKit Meet playground:

```bash
lk token create --room test-room --identity user --join --valid-for 1h --agent buildpro-sam --open meet
```

This opens `meet.livekit.io` with the token pre-filled. Allow microphone access — Sam will greet you automatically.

**Inbound phone call** — call the LiveKit phone number from a real phone. The dispatch rule routes the call to the agent. Check the agent logs for:

```
SIP caller: phone=+1... trunk=... callID=...
ModelGuide session: ... (user: +1...)
```

**Outbound phone call** — dispatch the agent to a room, then dial out via the Twilio trunk:

```bash
# 1. Dispatch the agent to a room (creates the room automatically)
lk dispatch create \
  --agent-name buildpro-sam \
  --room outbound-test-1

# 2. Dial out — the callee's phone rings, then joins the same room
lk sip participant create \
  --trunk ST_xxxx \
  --call +1XXXXXXXXXX \
  --room outbound-test-1 \
  --identity callee

# The agent and callee are now in the same room — agent starts talking
```

Replace `ST_xxxx` with your trunk ID and `+1XXXXXXXXXX` with the phone number to call.

## SIP Setup

Phone call support requires a one-time SIP configuration. See [`sip/README.md`](./sip/README.md) for the full guide. Quick summary:

**Inbound (LiveKit phone number):**

```bash
# Purchase a US phone number
lk number purchase --numbers +1XXXXXXXXXX

# Create dispatch rule (routes calls to the agent)
lk sip dispatch-rule create sip/dispatch-rule.json

# Link number to dispatch rule
lk number update --id <NUMBER_ID> --sip-dispatch-rule-id <DR_ID>

# Verify
lk number list
lk sip dispatch-rule list
```

**Outbound (Twilio SIP trunk):**

```bash
# 1. Set up trunk + credentials in Twilio Console (see sip/README.md)

# 2. Create the trunk config
cp sip/twilio-outbound-trunk.example.json sip/twilio-outbound-trunk.json
# Edit: address, numbers, auth_username, auth_password

# 3. Register in LiveKit
lk sip outbound create sip/twilio-outbound-trunk.json
# Returns trunk ID: ST_xxxx

# 4. Set the secret
lk agent update-secrets SIP_OUTBOUND_TRUNK_ID=ST_xxxx

# 5. Deploy
lk agent deploy

# 6. Verify
lk sip outbound list
```

> To switch to Telnyx or another provider, see the "Switching Outbound Providers" section in [`sip/README.md`](./sip/README.md).

## Useful commands

```bash
# Agent management
lk agent versions                # List deployed versions
lk agent rollback                # Roll back to previous version
lk agent update-secrets          # Update secrets (triggers restart)
lk agent restart                 # Restart without redeploying
lk agent delete                  # Remove the agent
lk agent logs                    # Tail logs (streaming)

# SIP / Phone
lk number list                   # List purchased phone numbers
lk sip dispatch-rule list        # List inbound dispatch rules
lk sip outbound list             # List outbound SIP trunks
lk sip participant create ...    # Dial out (see Test section above)
```

## Dockerfile

Multi-stage build:

1. **Builder stage** — Uses `uv` to install Python dependencies, downloads Silero VAD and turn detector models into a shared HF cache
2. **Runtime stage** — Slim Python image with a non-root `agent` user, HF model cache copied from builder

No custom base image needed — LiveKit Cloud runs standard Docker images.
