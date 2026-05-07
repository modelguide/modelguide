# ModelGuide Voice Agent (POC)

A minimal LiveKit voice agent that **pulls its system prompt from
ModelGuide at the start of every call**. Talk to it from the dashboard:

> Agents → *your agent* → **Compile** → **Voice Test** → Talk

…and the next call uses the prompt you just compiled. No worker redeploy.

This is the smaller, prompt-only sibling of
[`livekit-agent`](../livekit-agent) (the BuildPro Sam demo with 11 MCP
tools). Use this one when you want to iterate on prompts; use the other
when you want to exercise tool calls.

## How it works

```
                    ┌─────────────────┐
                    │   Dashboard UI  │
                    └────────┬────────┘
        Click Compile        │        Click Voice Test
                ▼            │            ▼
     ┌──────────────────┐    │    ┌──────────────────┐
     │ POST /agents/:id │    │    │  POST /agents/:id│
     │     /compile     │────┼───▶│ /voice-test-token│
     └──────────────────┘    │    └────────┬─────────┘
                             │             │ dispatch
                             │             ▼
                             │    ┌────────────────────┐
                             │    │  LiveKit dispatch  │
                             │    │ + JWT for browser  │
                             │    └────────┬───────────┘
                             │             │
                             │             ▼
                             │    ┌──────────────────────┐
                             └───▶│  this worker         │
       GET /agents/me/runtime-cfg │  ↳ resolves prompt   │
                                  │  ↳ AgentSession()    │
                                  └──────────────────────┘
```

1. Operator clicks **Compile** — API stores the result on
   `agents.compiled_instructions`.
2. Operator clicks **Voice Test** — API mints a LiveKit token + dispatches
   this worker into a fresh `voice-test-<nanoid>` room with metadata
   carrying `{ agentId, agentName, session_id, … }`.
3. Worker boot (this repo):
   - `parse_dispatch_metadata` decodes the metadata JSON.
   - `fetch_runtime_config` calls `GET /api/agents/me/runtime-config` with
     the worker's API key and gets `{ id, slug, name, modality,
     modelFamily, instructions, compiledAt }`.
   - `resolve_instructions` picks the prompt with this precedence: compiled
     prompt → `DEFAULT_INSTRUCTIONS` env override → built-in fallback.
   - LiveKit `AgentSession` starts with the resolved instructions.
4. Browser side (`VoiceTestPanel` in `modelguide-ui`) is unchanged — it
   just joins the room and starts publishing mic.

See [ADR-015](../../../docs/decisions/015-livekit-runtime-prompt-fetch.md)
for the design rationale.

## Quick start (local dev)

Prereqs: `python3.11+`, [`uv`](https://docs.astral.sh/uv/), API keys for
OpenAI / Deepgram / ElevenLabs, a running ModelGuide API.

```bash
# 1. Install deps
uv venv .venv
source .venv/bin/activate
uv pip install -e ".[test]"

# 2. Configure
cp .env.example .env
# Fill in MODELGUIDE_API_KEY (Agents → <agent> → Integration → "Generate API key")
# and your provider keys.

# 3. Console mode — no LiveKit server needed, text-only
python src/agent.py console

# OR: full WebRTC (needs LiveKit server running locally)
python src/agent.py dev
```

Then from the dashboard: pick the same agent, click **Compile**, then
**Voice Test**. Speak — you should hear the latest compiled prompt.

## Tests

```bash
source .venv/bin/activate
pytest -q
```

The tests are pure-Python and do not require LiveKit, OpenAI, or any
network access. They cover:

- `test_dispatch.py` — locks in the contract with the API's
  `buildVoiceTestDispatchMetadata` (must include `agentId`).
- `test_runtime_config.py` — runs the runtime-config fetch against a
  mocked transport (`respx`).
- `test_resolve_instructions.py` — pins the prompt-precedence rules so
  the LLM doesn't silently switch sources.

## Production deploy (LiveKit Cloud)

```bash
livekit-cli agent create  # picks up the Dockerfile and pyproject.toml
```

Set the same env vars as `.env.example` in your LiveKit Cloud dashboard.
The worker registers with `agent_name = AGENT_NAME` (default
`modelguide-voice-agent`) — make sure the corresponding ModelGuide
agent's `metadata.livekit.agentName` matches.

## What this POC intentionally does NOT do

- **No tools.** This is the smallest possible "talk to a prompt" loop.
  For tool-calling, see `examples/agents/livekit-agent` (BuildPro Sam).
- **No SIP / phone number.** WebRTC only.
- **No tracing / Langfuse / transcript posting.** Add these once the
  prompt-fetch mechanism stabilizes.
- **No auth-token rotation.** The worker uses a static API key, scoped
  per-agent, generated from the dashboard. If you need multi-agent
  routing in one worker process, see the alternatives section in
  ADR-015.
