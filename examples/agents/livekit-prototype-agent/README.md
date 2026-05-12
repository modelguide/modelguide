# livekit-prototype-agent

A minimal LiveKit voice agent that **fetches its system prompt from ModelGuide
at the start of every session**. Wire it up once, then iterate on the prompt
in the ModelGuide dashboard and click "Talk to agent" to hear the new version
— no worker redeploy.

This is the prototype counterpart to `examples/agents/livekit-agent`. That
agent bakes its prompt in via local Python source (`buildpro.py`) — great for
shipping a polished customer-specific demo. This one is the right starting
point when you want the **compile-and-test loop** described in
[ADR-015](../../../docs/decisions/015-agent-runtime-config-fetch.md).

## How it works

```
                          dashboard
                              │
                  ┌───────────┼───────────┐
                  │           │           │
              compile     "Talk to     watch the
              prompt       agent"       transcript
                  │           │           ▲
                  ▼           ▼           │
       ┌─────────────────────────────────────┐
       │  ModelGuide API                     │
       │  • POST /agents/:id/voice-test-token│   ── creates room,
       │  • GET  /agents/runtime-config      │      dispatches worker,
       │                                     │      mints LiveKit token
       └────────────────┬────────────────────┘
                        │  dispatch
                        ▼
       ┌─────────────────────────────────────┐
       │  livekit-prototype-agent (this)     │
       │  1. fetch_runtime_config()  ◄────── pulls LATEST compiled prompt
       │  2. AgentSession(...)               │   on every session
       │  3. LiveKitRoom audio loop          │
       └─────────────────────────────────────┘
                        ▲
                        │  WebRTC
                        │
                     browser
```

Everything else (STT, LLM, TTS, VAD, turn detection) is standard LiveKit
Agents v1.4 plumbing. Swap providers freely — the prompt-fetch is the only
ModelGuide-specific bit.

## Files

| File | Purpose |
|---|---|
| `src/agent.py` | LiveKit entrypoint. Fetches config, builds `AgentSession`, says hello. |
| `src/runtime_config.py` | `fetch_runtime_config` + `build_system_instructions`. **The only ModelGuide-specific code.** |
| `src/config.py` | Reads env vars. |
| `tests/test_runtime_config.py` | Unit tests for the fetch + fallback logic. |
| `tests/test_agent_integration.py` | Fetch + build composition tests. |

## Setup

Prerequisites:

- Python 3.11+
- A ModelGuide agent with `agentPlatform = livekit` and LiveKit credentials
  configured in the dashboard
- The agent's API key (`mgk_xxx` — shown once at agent creation)
- API keys for OpenAI (LLM), Deepgram (STT), ElevenLabs (TTS)
- LiveKit server: either `livekit-server --dev` locally or LiveKit Cloud

```bash
# In this directory
uv venv
uv pip install -e .
cp .env.example .env
# Fill in the values
```

### Env vars

| Var | Required | Purpose |
|---|---|---|
| `MODELGUIDE_API_URL` | yes | e.g. `http://localhost:3000` |
| `MODELGUIDE_API_KEY` | yes | The agent's `mgk_xxx` key |
| `AGENT_NAME` | yes | LiveKit worker identity — must match `metadata.livekit.agentName` on the ModelGuide agent |
| `OPENAI_API_KEY` | yes | LLM |
| `DEEPGRAM_API_KEY` | yes | STT |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | for local dev | Defaults match `livekit-server --dev`. LiveKit Cloud injects these automatically. |
| `FALLBACK_PROMPT` | no | Used when the agent has never been compiled. Defaults to a friendly "we're not ready" message. |
| `LLM_MODEL` | no | Default `gpt-4.1-mini` |
| `ELEVENLABS_VOICE_ID` | no | Default `iP95p4xoKVk53GoZ742B` (Chris) |

## Run

### Local with `livekit-server --dev`

```bash
# Terminal 1
livekit-server --dev

# Terminal 2 — the worker
python src/agent.py dev
```

Then in the ModelGuide dashboard, open the agent detail page, configure
LiveKit (`ws://localhost:7880`, `devkey`, `secret`) on it, and click
**Talk to agent**. The browser joins the room and you talk to the agent.

### Console mode (text-only smoke test)

```bash
python src/agent.py console
```

Type into stdin to exercise the prompt without the WebRTC stack — handy for
sanity-checking that the compiled prompt is being picked up.

### Deploy to LiveKit Cloud

```bash
lk agents create
lk agents deploy
```

LiveKit Cloud injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
at deploy time. Set the other env vars via `lk agents env`. See
[`examples/agents/livekit-agent/DEPLOY.md`](../livekit-agent/DEPLOY.md) for
the full LiveKit Cloud walk-through — the deploy story is identical.

## The compile-and-test loop

1. Edit your SOP / persona / guardrails in the dashboard.
2. Click **Compile**.
3. Open the agent and click **Talk to agent**.
4. The dashboard dispatches this worker. On session start, the worker calls
   `GET /api/agents/runtime-config` with its API key and gets back the prompt
   you just compiled.
5. Hang up, edit, compile, talk again — no redeploy.

The `VoiceTestPanel` in the dashboard shows the `compiledAt` timestamp so you
always know which version you're about to test.

## Testing

```bash
.venv/bin/pytest -v
```

The tests are pure-Python — no LiveKit server, no audio devices required.
The fetch + fallback logic was built **red-first**: the test in
`tests/test_runtime_config.py` pinned the API contract (Bearer auth, HTTP
path, error handling, null-prompt fallback) before `runtime_config.py`
existed.

## What this prototype deliberately does NOT do

- **No connector tools.** This is a prompt-driven prototype. If you want tool
  calls, copy `examples/agents/livekit-agent`'s `mg_client.py` +
  `mcp_agent.py` pattern and register `@function_tool` methods on your
  `Agent`.
- **No SIP / outbound calling.** Inbound WebRTC only. See ADR-011.
- **No post-call webhook posting.** This worker is for iteration, not for
  feeding the analytics pipeline. The dashboard creates a session row
  (so the transcript can be inspected) but the worker doesn't push messages
  back. Add a `core_add_messages` MCP call in the entrypoint when you need
  full attribution.
- **No prompt caching at the worker.** Every session fetches fresh. That's
  the whole point — see ADR-015.
