# LiveKit POC Voice Agent

The smallest possible LiveKit voice agent that runs against ModelGuide. It
exists for one reason: to make the dashboard's **Compile → Talk to agent**
loop actually mean something. On every session start, the worker fetches
the latest compiled system prompt from ModelGuide via
`GET /api/agents/me/runtime-config` — so when you click *Compile* in the UI
and then *Talk to agent*, the next greeting uses the prompt you just
edited. No worker redeploy, no cache to bust, no SOPs to forge.

This is the spiritual sibling of [voiceblox](https://github.com/voiceblox-ai/voiceblox)
adapted to ModelGuide's API surface. For the full-featured demo with MCP
tools, SOP guardrails, transcript sync, and SIP, see
[`examples/agents/livekit-agent`](../livekit-agent/) (BuildPro Sam).

## Architecture

```
Dashboard (modelguide-ui)
  ├── Compile prompt          → POST /api/agents/{id}/compile
  └── Talk to agent (button)  → POST /api/agents/{id}/voice-test-token
                                  → ModelGuide creates session +
                                    dispatches this worker into a room

LiveKit Cloud / livekit-server
  └── dispatches worker with metadata = { agentName, session_id, … }

POC worker (this directory)
  ├── on entrypoint:
  │     GET /api/agents/me/runtime-config   ← fetches LATEST compiled prompt
  │     (Bearer mgk_… — agent's own API key)
  ├── builds livekit.agents.AgentSession with that prompt
  ├── says a static greeting (predictable first-token latency)
  └── on shutdown: PATCH /api/sessions/{id} → completed
```

The `Agent.instructions` come straight from `compiled_instructions` in the
runtime-config response. If the agent has never been compiled, the worker
falls back to the prompt in `FALLBACK_INSTRUCTIONS` so the call still
completes — see `runtime_config.resolve_instructions`.

See [ADR-015](../../../docs/decisions/015-livekit-runtime-prompt-fetch.md)
for the rationale.

## Stack

| Component       | Service                                       |
| --------------- | --------------------------------------------- |
| Transport       | LiveKit WebRTC (Cloud or self-hosted)         |
| VAD             | Silero                                        |
| Turn detection  | LiveKit `EnglishModel` (end-of-utterance)     |
| STT             | Deepgram Nova-3                               |
| LLM             | OpenAI GPT-4.1-mini                           |
| TTS             | ElevenLabs Flash v2.5                         |
| Prompt source   | ModelGuide `GET /api/agents/me/runtime-config` |
| Tools           | None (POC scope — see BuildPro Sam for MCP)   |

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- API keys for OpenAI, Deepgram, ElevenLabs
- A running ModelGuide API + a LiveKit-platform agent with a `mgk_*` API
  key. In the dashboard:
  1. Create or open a voice agent.
  2. On the agent detail page, configure LiveKit (URL + API key + secret)
     and set `metadata.livekit.agentName = livekit-poc-agent` (this name
     must match `AGENT_NAME` in the worker's env so dispatches route
     here).
  3. Click *Generate API key* and copy it into the worker's
     `MODELGUIDE_API_KEY`.
  4. Edit the prompt blocks (or upload an SOP) and click *Compile*.

## Quick start

```bash
# 1. Install
uv venv
uv pip install -e ".[test]"
cp .env.example .env  # then edit with your keys

# 2. (Three terminals)
# Terminal 1 — local LiveKit
livekit-server --dev

# Terminal 2 — POC worker
python -m livekit_poc_agent.agent dev

# Terminal 3 — open the modelguide-ui dashboard, click "Talk to agent"
# on the agent's detail page.
```

Want a text-only loop (no LiveKit server, no mic)?

```bash
python -m livekit_poc_agent.agent console
```

## Testing — what's in the box

This is a TDD-grown POC. The contract between the worker and ModelGuide
is fixed by tests on both sides:

| Test                                                                       | What it locks in                                |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| `tests/test_runtime_config.py`                                             | `runtime_config.fetch` request shape + parsing  |
| `tests/test_mg_session.py`                                                 | Session create/complete swallows transient errors |
| `modelguide-api/tests/unit/agents/runtime-config.test.ts`                  | `formatRuntimeConfig` payload shape             |
| `modelguide-api/tests/integration/agent-runtime-config.test.ts`            | Route auth + response (API-key only)            |

```bash
# From this directory:
uv run pytest                  # 12 tests, ~0.1s

# From the repo root, the API contract test:
make api-test-unit             # includes runtime-config.test.ts
make api-test-integration      # includes agent-runtime-config.test.ts
```

## Deployment to LiveKit Cloud

1. Build & push the image (or let LiveKit Cloud build it):
   ```bash
   docker build -t ghcr.io/<you>/livekit-poc-agent:latest .
   ```
2. In LiveKit Cloud → *Agents*, register a worker with
   `agent_name = livekit-poc-agent` and the env vars from `.env.example`.
3. In the ModelGuide dashboard, set `metadata.livekit.agentName` on the
   agent to `livekit-poc-agent` so voice-test dispatches reach this worker.

The dispatch metadata produced by `createVoiceTestSession` is JSON-decoded
in the entrypoint and used for caller identity / session correlation. Any
fields beyond `agentName`, `session_id`, `user_identifier`, `email` are
ignored.

## Limitations (and how to lift them)

- **No tools.** Tool calling needs the MCP wiring from
  `examples/agents/livekit-agent/src/mg_client.py`. Drop in `MCPConnection`
  and decorate functions with `@function_tool` — the runtime-config flow
  is orthogonal and stays unchanged.
- **No transcript sync.** Reuse `TranscriptCollector` and the cleanup
  pattern from `examples/agents/livekit-agent/src/agent.py:_cleanup`.
- **No SIP.** This worker only takes WebRTC dispatches. SIP is purely
  additive; see the BuildPro Sam DEPLOY guide.
- **Prompt cached for the lifetime of the session.** A long-running call
  will not pick up a re-compile mid-stream. To support that, poll
  `runtime_config.fetch` periodically and update `agent.instructions`.

## Directory layout

```
src/livekit_poc_agent/
  __init__.py
  agent.py            # entrypoint — fetch prompt, run AgentSession
  config.py           # env validation + fallback prompt
  runtime_config.py   # GET /api/agents/me/runtime-config client
  mg_session.py       # POST/PATCH /api/sessions  (best-effort, never raises)
tests/
  test_runtime_config.py
  test_mg_session.py
.env.example
Dockerfile
pyproject.toml
README.md
```
