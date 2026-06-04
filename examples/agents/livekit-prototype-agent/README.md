# LiveKit Prototype Agent

A minimal LiveKit voice agent that pulls its system prompt from ModelGuide at
session start. Voiceblox-inspired single-file scaffold — the whole worker is
~150 lines of Python.

## What this proves

The dashboard already has a one-click **Talk to agent** button and a one-click
**Compile** button. What it didn't have until now is a worker that respects the
*latest* compiled prompt. Edit prompt → click Compile → click Talk → the very
next call uses the freshly compiled prompt. No redeploy, no sync step.

```text
┌──────────────────────────┐         ┌────────────────────────┐
│  modelguide-ui           │         │  modelguide-api        │
│   Compile button         │ ──────► │  POST /agents/:id/     │
│                          │         │       compile          │
│   Talk to agent button   │ ──────► │  POST /agents/:id/     │
│                          │         │       voice-test-token │
└──────────────────────────┘         └──────────┬─────────────┘
                                                │ dispatch (LiveKit)
                                                ▼
                                  ┌──────────────────────────────┐
                                  │  livekit-prototype-agent     │
                                  │   ① parse dispatch metadata  │
                                  │   ② GET /api/agents/me       │  ◄── pulls latest
                                  │   ③ start AgentSession with  │      compiledInstructions
                                  │      compiledInstructions    │
                                  └──────────────────────────────┘
```

The pull is at **session start**, not at worker boot — so a prompt edited
between calls takes effect on the next call.

## How is this different from `examples/agents/livekit-agent/` (BuildPro Sam)?

| Aspect | BuildPro Sam | Prototype |
|---|---|---|
| Prompt source | Python files in `prompts/` | `GET /api/agents/me` at session start |
| Pipeline | Deepgram STT → OpenAI LLM → ElevenLabs TTS | OpenAI Realtime (one provider) |
| Tools | 11 MCP-backed tools | None — conversational only |
| SIP support | Inbound + outbound | Inbound only (no Twilio integration) |
| Tracing | Langfuse | None |
| Lines of Python | ~700 | ~150 |

The BuildPro example is the reference implementation for a *production* agent
with tools. The prototype is the reference implementation for the **prompt
freshness loop**. Copy from BuildPro if you need tools / SIP / tracing.

See [ADR-015](../../../docs/decisions/015-livekit-runtime-prompt-fetch.md) for
the design rationale and the tradeoff against ADR-014.

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- An OpenAI API key with Realtime API access
- A running ModelGuide API with an active agent + LiveKit configured
- For local voice dev: LiveKit server (`brew install livekit livekit-cli` or
  Docker — see the BuildPro README)

## Local development

```bash
cd examples/agents/livekit-prototype-agent

# 1. Install deps + download VAD
uv venv && uv pip install -e .

# 2. Configure
cp .env.example .env
# Edit .env — set OPENAI_API_KEY, MODELGUIDE_API_URL, MODELGUIDE_API_KEY
```

Two terminals:

```bash
# Terminal 1 — LiveKit server (dev mode)
livekit-server --dev

# Terminal 2 — Prototype agent
source .venv/bin/activate
python src/agent.py dev
```

Then click **Talk to agent** in the dashboard, and the prototype joins the
room. The prompt the agent uses is whatever appeared in the dashboard's
"Compiled Prompt" card the last time you clicked Compile.

### Console mode (no LiveKit, no mic — text only)

```bash
python src/agent.py console
```

Great for quickly verifying a new prompt without setting up audio.

## Running the tests

```bash
uv pip install -e ".[test]"
python -m pytest -v
```

Tests cover three layers:

| File | What it pins |
|---|---|
| `tests/test_runtime_config.py` | Parser + fallback chain (compiled → persona → generic) |
| `tests/test_dispatch.py` | Dispatch-metadata contract with the API |
| `tests/test_mg_client.py` | REST client headers/paths (mocked HTTP via respx) |

The wire-format contract with `GET /api/agents/me` is double-locked by
`modelguide-api/tests/unit/agents/agent-runtime-config.test.ts` on the TypeScript
side. If either side changes a field name without the other, the matching test
on the opposite side fails — that's the type system across the language
boundary.

## Cloud deploy

Same pattern as the BuildPro example — see [its DEPLOY.md](../livekit-agent/DEPLOY.md)
for the full guide. Short version:

```bash
lk cloud auth login
cd examples/agents/livekit-prototype-agent

lk agent update-secrets \
  OPENAI_API_KEY=sk-... \
  LLM_MODEL=gpt-4o-realtime-preview \
  MODELGUIDE_API_URL=https://your-api.up.railway.app \
  MODELGUIDE_API_KEY=mgk_your_agent_key \
  AGENT_NAME=modelguide-prototype

lk agent create --region us-east -y
```

Then in the dashboard: open the agent → **LiveKit** card → set **Agent Name**
to `modelguide-prototype` (matching the `AGENT_NAME` secret above).

## Graduating to tools

When the prototype proves out and you want MCP-backed tools, copy from the
BuildPro example:

1. Copy `mcp_agent.py` and the MCP client bits from
   `examples/agents/livekit-agent/src/mg_client.py`.
2. Subclass `MCPAgent` instead of using `Agent` directly.
3. Add `@function_tool` methods on your subclass.
4. Make sure your agent's MG record has the connector tools assigned in the
   dashboard so they show up via MCP.

The runtime-config fetch from this prototype stays — the worker still pulls
the latest `compiledInstructions` at session start. The compiled prompt
includes the tool descriptions, so a freshly compiled prompt + a redeploy of
the tools layer is the iteration loop for full-featured agents.
