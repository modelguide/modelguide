# LiveKit Voice Agent for ModelGuide

A WebRTC voice agent powered by [LiveKit Agents](https://github.com/livekit/agents) that connects to ModelGuide for tool execution and session management. Implements the BuildPro "Sam" demo.

## Stack

| Component | Service |
|-----------|---------|
| Transport | LiveKit Cloud WebRTC |
| VAD | Silero |
| Turn Detection | End-of-Utterance Model |
| STT | Deepgram Nova-3 |
| LLM | OpenAI GPT-4.1-mini (function calling) |
| TTS | ElevenLabs Flash v2.5 |
| Tools | ModelGuide MCP (11 tools) |

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

## How it works

```
LiveKit Cloud Room (WebRTC)
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
  agent.py        # Entrypoint + BuildProAgent class + 11 @function_tool methods
  config.py       # Environment variable loading and validation
  mg_client.py    # ModelGuide REST + MCP client
  transcript.py   # In-memory transcript collector
  prompts/        # BuildPro "Sam" system prompt + 7 workflow modules
```

### Key differences from Pipecat agent

| Aspect | Pipecat | LiveKit |
|--------|---------|---------|
| Pipeline | Explicit frame processors wired in sequence | AgentSession manages STT→LLM→TTS internally |
| Tools | JSON schemas + `handle_tool_call()` handler | `@function_tool` decorated methods on Agent subclass |
| Transport | Daily.co WebRTC | LiveKit Cloud WebRTC |
| Cart tracking | Module-level global | Instance attribute on Agent |
| Turn detection | Silero VAD only (stop_secs) | EnglishModel (context-aware end-of-utterance) |

## Known Issues

**Never set `debug=True` on the Langfuse SDK.** Confirmed via A/B testing on LiveKit Cloud: `debug=True` adds ~2-3s latency per voice turn. The debug flag enables synchronous console logging on every span export, which compounds the already-blocking `OTLPSpanExporter` and LiveKit Cloud's own `BatchSpanProcessor`. With `debug=False` (the default), Langfuse tracing adds negligible overhead. Tracing is opt-in (set `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`).

## Future Improvements

- **`EndCallTool`** — LiveKit agents ships a built-in [`EndCallTool`](https://docs.livekit.io/agents/build/end-call-tool/) (`livekit.agents.beta.tools.end_call`) that lets the LLM decide when to hang up via tool calling instead of the current event-based state machine. Worth evaluating once it graduates from beta.

## LiveKit Cloud Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions.
