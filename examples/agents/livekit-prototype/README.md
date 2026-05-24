# LiveKit Prototype Agent — Runtime Prompt Fetch

A minimal LiveKit voice agent that **fetches its compiled prompt and tool
catalog from ModelGuide at session start**. Unlike the production
[`livekit-agent`](../livekit-agent) (BuildPro Sam) example — which bakes
the prompt into the worker image — this prototype lets you:

1. Edit the agent's SOP / persona in the ModelGuide dashboard
2. Click **Compile Prompt**
3. Click **Talk to agent**
4. Hear the new prompt immediately, with no worker redeploy

Status: **prototype only**. See [ADR-015](../../../docs/decisions/015-livekit-prototype-runtime-prompt-fetch.md)
for the design and the explicit trade-offs vs. the production pattern in
[ADR-014](../../../docs/decisions/014-browser-voice-testing.md).

---

## How it works

```
LiveKit room (WebRTC, dispatched by the API's voice-test-token endpoint)
   ↓
entrypoint(ctx)
   ├── GET /api/agents/me           — fetch compiledInstructions (system prompt)
   ├── MCP ListTools                 — discover agent tools
   ├── _build_dynamic_tools(...)     — wrap each MCP tool as a @function_tool
   ↓
AgentSession(STT → LLM(tools) → TTS)
   ↓
Caller talks to the agent. Every tool the operator assigned in the
dashboard is available to the LLM, with the latest compiled prompt as
its system instructions.
```

### The two ModelGuide endpoints the worker calls

| Call | Method | Path | Auth | Returns |
|---|---|---|---|---|
| Prompt fetch | `GET` | `/api/agents/me` | Bearer `mgk_…` | The full agent record (uses only `compiledInstructions` + `id`) |
| Tool execution | `POST` | `/mcp/:agent_id` | Bearer `mgk_…` | MCP streaming responses |

Both are authenticated by the same `MODELGUIDE_API_KEY`. The agent UUID
is read from `GET /me`'s response — the worker doesn't need to know it
ahead of time.

## Repository layout

```
src/
  agent.py        # LiveKit entrypoint — fetch + wire + session lifecycle
  config.py       # Env loading + FALLBACK_INSTRUCTIONS
  mg_prompt.py    # GET /api/agents/me client (httpx)
  mg_mcp.py       # MCP client + dynamic-tool description builder
  providers.py    # Deepgram STT + ElevenLabs TTS factories
tests/
  test_mg_prompt.py  # Prompt fetcher contract tests (10 cases)
  test_mg_mcp.py     # URL + tool-description format tests (5 cases)
```

## Quick start (local)

Prereqs: Python 3.11+, [uv](https://docs.astral.sh/uv/), a running ModelGuide
API with an agent that has been **compiled** at least once, and API keys for
OpenAI / Deepgram / ElevenLabs.

```bash
cd examples/agents/livekit-prototype

# Install deps + download VAD/turn-detector model weights
uv venv && uv pip install -e ".[test]"

# Configure
cp .env.example .env
# Edit .env — set MODELGUIDE_API_KEY to your agent's mgk_ key

# Run unit tests (no network, no LiveKit needed)
.venv/bin/pytest tests/ -v

# Start the worker in dev mode (needs a running livekit-server)
.venv/bin/python src/agent.py dev
```

Then from the dashboard, click **Talk to agent** on the agent whose API key
matches `MODELGUIDE_API_KEY`. The worker picks up the dispatch, fetches
the compiled prompt, and starts the call.

## Deploying to LiveKit Cloud

The Dockerfile is identical to the production worker's — same multi-stage
uv build, same Silero/turn-detector weight pre-pull. Push the image and
configure the worker name in LiveKit Cloud to match `AGENT_NAME` in `.env`.

Reuse the existing `livekit.toml` pattern from `examples/agents/livekit-agent`
if you want a single-command deploy.

## What's NOT in scope

The prototype intentionally drops some features from the production worker
to keep the runtime-fetch loop legible:

| Feature | Production (`livekit-agent`) | Prototype |
|---|---|---|
| System prompt | Baked into `prompts/` package | `GET /api/agents/me` at session start |
| Tool wiring | Explicit `@function_tool` per tool | Dynamic from MCP `ListTools` |
| SIP / phone in/out | Yes | Browser-only |
| Hang-up state machine | Yes (`hangup.py`) | Caller hangs up the room |
| Langfuse tracing | Yes (opt-in) | No |
| Transcript posting | Yes | No (handled by the API session) |
| Stubbed tools | Yes (`STUBBED_TOOLS` env) | No (only real MCP tools surface) |

If you need any of those for a real deployment, copy the production worker
and add the runtime-fetch step to its entrypoint instead — don't extend
this prototype into production.

## Testing

```bash
# Pure unit tests — no LiveKit, no network
pytest tests/ -v
```

The tests cover the runtime-fetch contract end-to-end (happy path, every
HTTP error class, missing compile, malformed responses) and pin the
tool-description format the LLM sees. They use an in-process httpx
`MockTransport`, so they run in well under a second.

See [`test_mg_prompt.py`](tests/test_mg_prompt.py) and
[`test_mg_mcp.py`](tests/test_mg_mcp.py) for the full inventory.
