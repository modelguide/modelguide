# LiveKit Prototype Agent

A minimal LiveKit voice agent that proves the **compile → sync → talk** loop
in ModelGuide: edit a prompt in the dashboard, click "Compile", click "Talk
to agent", and the very next room you join is already using the new
instructions. No worker redeploy.

Inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox)
— intentionally smaller than the production `examples/agents/livekit-agent`
(no MCP tools, no SOPs, no transcript posting, no SIP). Just enough to
demo the dynamic-prompt loop end-to-end.

## Why a separate prototype?

The production LiveKit agent bakes its prompt into the container image at
build time. That makes prompt iteration expensive: every tweak is a deploy.
Reasonable for stable production, painful while you're still figuring out
what the agent should say.

This prototype trades that off: one extra `GET /api/agents/me/prompt`
round-trip on the room-join path (~50 ms), in exchange for prompts that
update the moment the dashboard says "Compiled". See
[ADR-015](../../../docs/decisions/015-livekit-prototype-dynamic-prompts.md)
for the design rationale and rollout plan.

## How the loop works

```
┌────────────────────────────────────────────────────────────────┐
│                       modelguide-ui                            │
│  1. Edit persona / SOP                                         │
│  2. Click "Compile" → /api/agents/:id/compile                  │
│  3. Click "Talk to agent" → /api/agents/:id/voice-test-token   │
└────────────────────────────────────────────────────────────────┘
                              │
                              │ (LiveKit dispatch)
                              ▼
┌────────────────────────────────────────────────────────────────┐
│           LiveKit prototype agent (this directory)             │
│                                                                │
│  entrypoint:                                                   │
│    GET /api/agents/me/prompt  ← fetch the JUST-compiled prompt │
│    Agent(instructions=<that prompt>)                           │
│    AgentSession(stt, llm, tts).start()                         │
│    session.say(GREETING)                                       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                Browser plays agent audio via WebRTC
```

The dashboard endpoint and dispatch metadata are unchanged from the
production agent — only the worker's prompt source moves from "baked into
image" to "fetched at session start".

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- API keys for OpenAI, Deepgram and ElevenLabs
- A running ModelGuide API with an agent that has:
  - `agent_platform = livekit`
  - LiveKit URL, API key, API secret configured
  - **A compiled prompt** (click "Compile" in the dashboard once)

## Quick start (local)

```bash
cd examples/agents/livekit-prototype

# 1. Install + download model weights
uv venv .venv
uv pip install --python .venv/bin/python ".[test]"

# 2. Configure
cp .env.example .env
# edit .env — set MODELGUIDE_API_KEY (mgk_xxx from the dashboard),
# plus OPENAI / DEEPGRAM / ELEVENLABS keys

# 3. Run the tests (no LiveKit, no network needed)
.venv/bin/python -m pytest tests/

# 4. Talk to it
# Terminal 1 — LiveKit server
make livekit-up        # from repo root, or use livekit-server --dev
# Terminal 2 — agent worker
.venv/bin/python src/agent.py dev
# Terminal 3 — open the ModelGuide dashboard, click "Talk to agent"
```

Or text-only, no LiveKit needed:

```bash
.venv/bin/python src/agent.py console
```

## Deploying to LiveKit Cloud

```bash
lk cloud agents create   # uses livekit.toml
```

LiveKit Cloud injects `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
automatically; you still need to set the model + ModelGuide env vars in the
Cloud project. The `Dockerfile` is a standard multi-stage build with model
weights warmed at build time, so cold starts stay sub-second.

## What's in the box

```
src/
  agent.py            # CLI entrypoint, session lifecycle
  prompt_fetcher.py   # GET /api/agents/me/prompt + fallback handling
  instructions.py     # Compose final system prompt (compiled or fallback)
  config.py           # Env vars, validation
tests/
  test_prompt_fetcher.py   # 6 cases — happy path, 4xx/5xx, network, JSON
  test_instructions.py     # 3 cases — compiled vs fallback composition
  conftest.py              # Test env + sys.path
pyproject.toml
Dockerfile
livekit.toml
.env.example
```

## Tests

Pure-Python, no Docker, no LiveKit:

```bash
.venv/bin/python -m pytest tests/ -v
```

The fetcher tests use `httpx.MockTransport` to record every outbound
request, so we assert on the URL, the `Authorization: Bearer` header, and
the full response decode rather than mocking out the network at a higher
level.

## Limits of this prototype

- **No tools.** The LLM can only talk — no `add_to_cart`, no `book_appointment`.
  Bolt MCP back on once the prompt loop is solid (see `mcp_agent.py` in the
  production agent for the pattern).
- **No transcript posting.** Sessions don't get recorded to ModelGuide.
- **No SIP.** Browser WebRTC only. Plug in `examples/agents/livekit-agent/sip/`
  when you need phone calls.
- **No Langfuse.** Tracing not wired in.

These are all deliberate omissions to keep the prototype small. The production
agent at `examples/agents/livekit-agent` has all of them — once the
dynamic-prompt loop graduates, the right move is to pull the prompt fetch
into the production agent rather than expanding this one.
