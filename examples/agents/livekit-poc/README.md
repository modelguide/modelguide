# livekit-poc — talk to the latest compiled prompt

A minimal LiveKit voice worker that fetches its system prompt from
ModelGuide on every session. Built for one purpose: a tight
**compile → click test → talk** loop on the dashboard so an operator
can iterate on a prompt without rebuilding a worker image.

Inspired by the lean, prompt-driven worker pattern in
[voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox).
See [ADR-015](../../../docs/decisions/015-livekit-poc-prompt-driven-worker.md)
for why this exists alongside (not replacing) the production worker
in [`../livekit-agent`](../livekit-agent/README.md).

## What this is NOT

- **Not the production voice agent.** No MCP, no tool wiring, no
  scenario logic. Use it for prompt iteration only.
- **Not a replacement for ADR-014.** The existing "Talk to agent" flow
  in the dashboard already dispatches the canonical worker. This POC
  is an additional worker you can point an agent at when you want
  prompt-only iteration.

## Architecture

```
modelguide-ui
  ↓  (Compile + Talk to agent)
modelguide-api  POST /agents/:id/voice-test-token
  → createSession()
  → buildVoiceTestDispatchMetadata({ agent_id, agentName, session_id, ... })
  → dispatchAgentToRoom(agentName: "livekit-poc", metadata)
  → returns AccessToken
            ↓
LiveKit Cloud / dev server
            ↓  (dispatch with metadata)
livekit-poc worker
  → prompt_loader.extract_agent_id(metadata)        ← agent_id
  → prompt_loader.load_prompt(agent_id)              ← GET /api/agents/:id
  → AgentSession(stt, llm, tts, vad, turn-detector)
  → say("Hi, I'm using the latest compiled prompt.")
```

Operator UX:

1. Edit a SOP in the dashboard.
2. Click **Compile** on the agent's detail page.
3. Click **Talk to agent**.
4. The browser joins a LiveKit room. The worker starts, fetches the prompt
   it just heard about, and greets the operator with it loaded.
5. Hang up. Iterate.

## Quick start

All commands run from this directory unless noted.

```bash
# 1. Install
uv sync                                  # or `pip install -e ".[test]"`

# 2. Configure
cp .env.example .env
# Edit .env — set OPENAI / DEEPGRAM / ELEVENLABS keys + MODELGUIDE_API_KEY
```

### Console mode (no LiveKit needed — useful for prompt smoke tests)

```bash
# Set MODELGUIDE_AGENT_ID in .env first so console mode knows which agent to fetch.
python src/agent.py console
```

Type text → the agent fetches its prompt → responds via LLM. No audio,
no LiveKit server.

### Local LiveKit dev

```bash
# Terminal 1: LiveKit server (from the repo root)
make livekit-up        # or `make livekit-up-docker`

# Terminal 2: this worker
LIVEKIT_URL=ws://localhost:7880 \
LIVEKIT_API_KEY=devkey \
LIVEKIT_API_SECRET=secret \
python src/agent.py dev

# Terminal 3: dispatch + a browser tab to talk
make livekit-token NAME=tester
```

### Production (LiveKit Cloud)

```bash
docker build -t livekit-poc .
# Push to your registry, deploy as a LiveKit Cloud Agent worker
# with agent_name="livekit-poc" — see livekit.toml or the LiveKit docs.
```

Then configure a ModelGuide agent's LiveKit metadata to dispatch into
this worker:

- Agent detail page → **LiveKit** card → Configure
- `Agent Name` = `livekit-poc` (matches `AGENT_NAME` env var in the worker)
- Save → click **Talk to agent**.

## Tests

```bash
pip install -e ".[test]"
pytest
```

The suite is structured red→green→refactor:

- `tests/test_prompt_loader.py` — the heart. Asserts the fetch / fallback
  / metadata extraction contract. Run this and you've covered ~90% of
  the worker-side behaviour without standing up LiveKit.
- `tests/test_transcript.py` — append-only collector, whitespace
  handling, JSON-serializable output.
- `tests/test_config.py` — env validation, idempotence, URL
  normalization.

## Why a separate worker?

| | livekit-agent (production) | livekit-poc (this) |
|--|--|--|
| Tools / MCP | Yes (BuildPro scenario) | No |
| Prompt source | Baked into image at build | Fetched from ModelGuide at session start |
| Use case | "Talk to the deployed agent" | "Talk to the prompt I just compiled" |
| Worker name | per-customer (e.g. `glowbox-voice-agent`) | `livekit-poc` (one shared instance) |
| Dispatch metadata read | `agentName` (profile slug) | `agent_id` (UUID) |

The two workers can coexist behind one LiveKit project — pick which one
to dispatch into by setting the agent's `metadata.livekit.agentName` in
the dashboard.

## Related

- [ADR-014: Browser Voice Testing via LiveKit Dispatch](../../../docs/decisions/014-browser-voice-testing.md) — the existing "Talk to agent" flow that we extend.
- [ADR-015: LiveKit POC Worker — Prompt-Driven Iteration](../../../docs/decisions/015-livekit-poc-prompt-driven-worker.md) — why this exists.
- [examples/agents/livekit-agent/](../livekit-agent/) — the production BuildPro voice agent with tools.
