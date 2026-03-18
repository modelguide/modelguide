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
| Tools | ModelGuide MCP (10 tools) |

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip
- A running ModelGuide API with a configured agent (API key + connector tools assigned)
- API keys for OpenAI, Deepgram, and ElevenLabs
- For dev/start modes: LiveKit server (local or cloud)

## Setup

```bash
cd examples/agents/livekit-agent

# Install dependencies
uv sync

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Download model files (turn detector, VAD)
python src/agent.py download-files
```

## Running

### Console mode (text-only, no WebRTC)

```bash
python src/agent.py console
```

Type text and see tool calls execute against ModelGuide. Great for testing tools without audio.

### Dev mode (full WebRTC)

```bash
python src/agent.py dev
```

Starts a worker with a dev server. Open the printed URL to join a LiveKit room and talk to Sam.

### Production mode

```bash
python src/agent.py start
```

Runs as a LiveKit Cloud worker, accepting jobs dispatched by the platform.

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
  agent.py        # Entrypoint + BuildProAgent class + 10 @function_tool methods
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

**Langfuse `debug=True` causes severe latency.** The Langfuse SDK's debug mode adds synchronous logging on every span export, compounding the already-blocking `OTLPSpanExporter`. On LiveKit Cloud a second `BatchSpanProcessor` is also added automatically for LiveKit's own observability. With `debug=True` removed, Langfuse tracing adds negligible overhead. Tracing is opt-in (set `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`).

## LiveKit Cloud Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions.
