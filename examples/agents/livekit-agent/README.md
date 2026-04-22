# LiveKit Voice Agent for ModelGuide

A WebRTC voice agent powered by [LiveKit Agents](https://github.com/livekit/agents) that connects to ModelGuide for tool execution and session management. Implements the BuildPro "Sam" demo.

## Stack

| Component | Service |
|-----------|---------|
| Transport | LiveKit Cloud WebRTC + SIP (phone) |
| VAD | Silero |
| Turn Detection | End-of-Utterance Model |
| STT | Deepgram Nova-3 |
| LLM | OpenAI GPT-4.1-mini (function calling) |
| TTS | ElevenLabs Flash v2.5 |
| Tools | ModelGuide MCP (11 tools) |
| Phone (inbound) | LiveKit native phone number |
| Phone (outbound) | Twilio SIP trunk |

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- API keys for OpenAI, Deepgram, and ElevenLabs
- A running ModelGuide API with a configured agent (API key + connector tools assigned)
- For local voice dev: LiveKit server + CLI (`brew install livekit livekit-cli` or Docker)

## Quick Start (local voice dev)

All commands run from the **repo root**.

```bash
# 1. Install deps + download VAD/turn-detector models (one-time)
make lk-agent-setup

# 2. Configure environment
cd examples/agents/livekit-agent
cp .env.example .env
# Edit .env with your API keys (OpenAI, Deepgram, ElevenLabs, ModelGuide)
cd -
```

Then open **three terminals**:

```bash
# Terminal 1 — LiveKit server
make livekit-up              # native (brew install livekit)
# OR
make livekit-up-docker       # Docker (no brew needed)

# Terminal 2 — Voice agent
make lk-agent-dev

# Terminal 3 — Join the room (opens meet.livekit.io in browser)
make livekit-token           # default identity: artur
make livekit-token NAME=sam  # custom identity
```

Click **Join** in the browser, allow mic access, and talk to Sam.

> **How it connects:** `livekit-server --dev` uses built-in credentials (`devkey` / `secret`) on `ws://localhost:7880` — these match `.env.example` defaults. The `--agent buildpro-sam` flag in the token tells LiveKit to dispatch the agent to the room.

### Console mode (text-only, no LiveKit needed)

```bash
make lk-agent-console
```

Type text and see tool calls execute against ModelGuide. Great for testing tools without audio.

### Production mode

```bash
cd examples/agents/livekit-agent
python src/agent.py start
```

Runs as a LiveKit Cloud worker, accepting jobs dispatched by the platform.

## Debugging

**Log levels** — defaults to `info` (no latency impact). Bump when you need more detail:

```bash
make lk-agent-dev                    # info (default)
make lk-agent-dev LK_LOG_LEVEL=debug # + internal state changes
make lk-agent-dev LK_LOG_LEVEL=trace # + every frame/event
```

Levels: `trace` > `debug` > `info` > `warn` > `error` > `critical`

**Connect mode** — attach to an existing room (useful for breakpoints / step-debugging):

```bash
cd examples/agents/livekit-agent
python src/agent.py connect --room test-room
```

**LiveKit server logs** (Docker):

```bash
docker logs -f livekit-agent-livekit-server-1
```

**Langfuse tracing** — set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` in `.env` for per-session traces in the Langfuse dashboard. Never set `debug=True` on the Langfuse SDK (adds ~2-3s latency per turn — see Known Issues).

## Makefile Reference

| Command | Description |
|---------|-------------|
| `make lk-agent-setup` | Install deps + download model files |
| `make lk-agent-dev` | Start agent in WebRTC dev mode |
| `make lk-agent-console` | Start agent in text-only console mode |
| `make livekit-up` | Start local LiveKit server (native) |
| `make livekit-up-docker` | Start local LiveKit server (Docker) |
| `make livekit-down` | Stop Docker LiveKit server |
| `make livekit-token` | Generate token + open meet.livekit.io |

## Phone Calls (SIP)

The agent supports phone calls via SIP in addition to browser WebRTC. See [`sip/README.md`](./sip/README.md) for setup and [`DEPLOY.md`](./DEPLOY.md) for deployment.

- **Inbound:** Purchase a LiveKit phone number and create a dispatch rule — callers are routed to the agent automatically
- **Outbound:** Configure a Twilio SIP trunk — the agent (or external API) can dial out to phone numbers

When a SIP call comes in, the agent detects the caller's phone number from participant attributes and uses it as the session identifier (instead of the hardcoded `USER_EMAIL`).

**Quick test (outbound):**

```bash
# Dispatch agent to a room, then dial out
lk dispatch create --agent-name buildpro-sam --room outbound-test-1
lk sip participant create \
  --trunk ST_xxxx \
  --call +1XXXXXXXXXX \
  --room outbound-test-1 \
  --identity callee
```

## Voice-Test POC — "Sync & Test" (ADR-015)

The dashboard has two voice-test buttons against this worker:

| Button | Endpoint | Dispatch metadata | Prompt used |
|---|---|---|---|
| **Talk to agent** | `POST /agents/:id/voice-test-token` | `mode: "voice-test"` | Baked-in (this worker's `prompts/` module) |
| **Sync & Test** | `POST /agents/:id/voice-test-poc-token` | `mode: "voice-test-poc"` + `compiled_instructions` | The freshly-compiled prompt from the dashboard |

"Sync & Test" is the admin iteration loop: edit SOPs → Compile → click Sync
& Test → hear the new prompt without rebuilding the Docker image. See
[ADR-015](../../../docs/decisions/015-voice-test-prompt-injection-poc.md)
for the full rationale, tradeoffs, and guards.

### Worker contract

`src/voice_test_poc.py` exposes `resolve_instructions(metadata, default)`.
At dispatch time, `agent.py` calls:

```python
resolved = resolve_instructions(dispatch_metadata, default=built_system_prompt)
```

- If the dispatch carries `mode: "voice-test-poc"` with a non-empty
  `compiled_instructions` string → the worker runs with the override.
- **Every** other case (prod voice-test, outbound SIP, no mode at all,
  blank/wrong-type override) → the worker runs with its baked prompt.
  The silent-fallback failure mode is "admin thinks they're testing
  prompt X but worker is running Y"; the tests in
  `tests/test_voice_test_poc.py` lock down every route back to the
  baked default so no silent mismatch can happen.

### Size cap

The API enforces a 32 KB UTF-8 byte cap on the injected prompt (LiveKit
dispatch metadata ceiling is ~48 KB total; 32 KB leaves headroom for
the rest of the JSON envelope). If you compile a prompt that exceeds
this, the API returns 400 *before* dispatching — you never end up in
a "dispatch ran but the prompt was truncated mid-sentence" state.

### When NOT to use this

- **Final validation of what prod will run.** Use "Talk to agent"
  instead — it hits the *deployed* worker image with whatever prompt
  is baked in. That's what prod phone traffic will use.
- **Multi-profile workers.** The `agentName` routing contract still
  applies; if your worker has multiple profiles, "Sync & Test" still
  dispatches to the profile matching `agent.slug`, and only overrides
  *that profile's* prompt.

### Running the worker-side tests

```bash
cd examples/agents/livekit-agent
pytest tests/test_voice_test_poc.py -v
```

The tests import `voice_test_poc` directly (no LiveKit dependencies),
so they run in any Python 3.11+ environment.

## How it works

```
LiveKit Cloud Room (WebRTC or SIP)
  ↕
AgentSession
  ├── Silero VAD (voice activity detection)
  ├── EnglishModel (turn detection)
  ├── Deepgram STT (speech-to-text)
  ├── OpenAI LLM (function calling)
  └── ElevenLabs TTS (text-to-speech)
  ↕
BuildProAgent (@function_tool methods)
  ↕
mg_client (REST + MCP)
  ↕
ModelGuide API
```

**Session lifecycle:**
- On connect: Creates a ModelGuide session via `POST /api/sessions`
- During call: LLM tool calls execute via ModelGuide's MCP endpoint (`POST /mcp/:agentId`)
- On goodbye: Agent signs off → user confirms → agent replies once → auto-disconnect after 3s
- On close: Posts the full transcript to ModelGuide, then marks the session as completed

**Tool mapping:** The LLM uses short tool names (`list_products`, `add_to_cart`). These are mapped to connector-prefixed MCP names (`glowbox_store_list_products`, `glowbox_store_add_to_cart`) in the `BuildProAgent._call_mcp_tool()` method.

## Architecture

```
src/
  agent.py        # CLI entry point, session lifecycle, SIP detection, event handlers
  mcp_agent.py    # MCPAgent base class (tool execution, tracing, transcripts)
  buildpro.py     # BuildProAgent — tools + hooks for contractor supply scenario
  config.py       # Environment variables (AGENT_NAME, CONNECTOR_PREFIX, etc.)
  providers.py    # STT/TTS factory functions (Deepgram, ElevenLabs, Cartesia)
  tracing.py      # Langfuse OpenTelemetry setup
  hangup.py       # Auto-hangup state machine
  mg_client.py    # ModelGuide REST + MCP client
  transcript.py   # In-memory transcript collector
  prompts/        # System prompt (base + 7 auto-discovered workflow modules)
sip/
  dispatch-rule.json                # Inbound call routing config
  twilio-outbound-trunk.example.json  # Twilio outbound template
  telnyx-outbound-trunk.example.json       # Telnyx outbound template (backup)
  README.md                          # SIP setup guide
```

### Key differences from Pipecat agent

| Aspect | Pipecat | LiveKit |
|--------|---------|---------|
| Pipeline | Explicit frame processors wired in sequence | AgentSession manages STT→LLM→TTS internally |
| Tools | JSON schemas + `handle_tool_call()` handler | `@function_tool` decorated methods on Agent subclass |
| Transport | Daily.co WebRTC | LiveKit Cloud WebRTC |
| Cart tracking | Module-level global | Instance attribute on Agent |
| Turn detection | Silero VAD only (stop_secs) | EnglishModel (context-aware end-of-utterance) |

## Creating a New Agent Scenario

The agent is split into a reusable base class (`MCPAgent` in `mcp_agent.py`) and a scenario-specific subclass (`BuildProAgent` in `buildpro.py`). To create a different agent — say a healthcare booking assistant or a SaaS support bot — you only touch the scenario layer. Everything else works automatically.

### What you get for free (MCPAgent base class)

These work identically for any scenario with zero configuration:

- **MCP tool execution** — persistent connection to ModelGuide, with one-shot fallback
- **Tool name mapping** — short names (`book_appointment`) auto-map to connector-prefixed MCP names (`clinic_connector_book_appointment`) via `CONNECTOR_PREFIX`
- **Langfuse tracing** — every tool call gets an OTel span, flows to Langfuse if keys are set
- **Transcript recording** — user utterances, assistant responses, and tool calls collected and posted to ModelGuide on session close
- **Session lifecycle** — ModelGuide session created on connect, completed/abandoned on disconnect
- **Stubbed tools** — tools without an MCP backend return fake success (configured via `STUBBED_TOOLS` env var)
- **Error handling** — tool failures logged, recorded in transcript, and surfaced as `ToolError` to the LLM
- **Shared HTTP client** — single connection pool for all REST calls to ModelGuide

### Steps to create a new agent

**1. Create your agent file** (copy `buildpro.py` → `your_agent.py`):

```python
from mcp_agent import MCPAgent
from livekit.agents import RunContext, function_tool

class YourAgent(MCPAgent):
    TOOL_NAMES = ["book_appointment", "list_doctors", "get_patient"]

    def __init__(self, *, session_id, user_email, mcp=None):
        instructions = build_your_prompt(session_id or "", user_email)
        super().__init__(session_id=session_id, mcp=mcp, instructions=instructions)

    @function_tool()
    async def book_appointment(self, context: RunContext, doctorId: str = "", date: str = "") -> str:
        """Book an appointment with a doctor."""
        return await self._call_mcp_tool("book_appointment", {"doctorId": doctorId, "date": date})

    # Override hooks only if your scenario needs them:
    async def _transform_args(self, tool_name, args):
        """Inject patientId, nest address fields, etc."""
        return args

    def _on_tool_result(self, tool_name, result):
        """Extract booking confirmation ID, etc."""
        pass

    def _check_guardrail(self, tool_name, args):
        """Block double-booking, enforce workflow order, etc."""
        return None
```

**2. Write new prompts:**

- Replace `prompts/base.py` with your agent's personality, tone rules, and tool documentation
- Add workflow files in `prompts/workflows/` — they're auto-discovered (just export a `PROMPT` string)

**3. Update `.env`:**

```bash
AGENT_NAME=clinic-assistant
CONNECTOR_PREFIX=clinic_connector
STUBBED_TOOLS=            # empty = all tools hit MCP
```

**4. Change one import in `agent.py`:**

```python
from your_agent import YourAgent as AgentClass
```

That's it. Langfuse traces, ModelGuide session tracking, transcript posting, and the MCP connection all work without changes.

## Stubbed Tools

Some tools return fake success responses because their MCP backend doesn't exist yet (e.g. `send_email` — no email connector is deployed). Instead of removing the tool from the LLM (which would break the prompt and demo flow), the agent returns a canned `{"success": true}` response so the conversation continues naturally.

**How it works:**

- `STUBBED_TOOLS` env var lists comma-separated tool names that are stubbed (default: `send_email`)
- When the LLM calls a stubbed tool, `BuildProAgent._call_mcp_tool()` returns a fake success without hitting MCP
- The stub is logged and recorded in the transcript so you can see it happened

**When a real connector arrives:**

1. Deploy the connector and assign its tools to the agent in ModelGuide
2. Remove the tool name from `STUBBED_TOOLS` in `.env` (e.g. `STUBBED_TOOLS=` for none)
3. Restart the agent — the tool now executes via MCP like all others

No code changes needed. The tool's `@function_tool` definition and MCP name mapping already exist.

## Known Issues

**Never set `debug=True` on the Langfuse SDK.** Confirmed via A/B testing on LiveKit Cloud: `debug=True` adds ~2-3s latency per voice turn. The debug flag enables synchronous console logging on every span export, which compounds the already-blocking `OTLPSpanExporter` and LiveKit Cloud's own `BatchSpanProcessor`. With `debug=False` (the default), Langfuse tracing adds negligible overhead. Tracing is opt-in (set `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`).

## Future Improvements

- **`EndCallTool`** — LiveKit agents ships a built-in [`EndCallTool`](https://docs.livekit.io/agents/build/end-call-tool/) (`livekit.agents.beta.tools.end_call`) that lets the LLM decide when to hang up via tool calling instead of the current event-based state machine. Worth evaluating once it graduates from beta.

## LiveKit Cloud Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions.
