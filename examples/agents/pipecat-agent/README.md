# Pipecat Voice Agent for ModelGuide

A WebRTC voice agent powered by [Pipecat](https://github.com/pipecat-ai/pipecat) that connects to ModelGuide for tool execution and session management. Implements the BuildPro "Sam" demo.

## Stack

| Component | Service |
|-----------|---------|
| Transport | Daily.co WebRTC |
| STT | Deepgram |
| LLM | OpenAI GPT-4.1-mini / Google Gemini (configurable via `LLM_MODEL`) |
| TTS | ElevenLabs (Flash v2.5) |
| Tools | ModelGuide MCP |

## Prerequisites

- Python 3.11+
- A running ModelGuide API with a configured agent (API key + connector tools assigned)
- API keys for Daily.co, OpenAI, Deepgram, and ElevenLabs

## Setup

```bash
cd examples/agents/pipecat-agent

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e .

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

## Running

```bash
python src/bot.py
```

The bot will:
1. Create a Daily.co room and print the URL
2. Create a ModelGuide session
3. Wait for a participant to join

Open the printed Daily room URL in your browser to start talking to Sam.

## How it works

```
Daily WebRTC Input
  -> Deepgram STT (speech-to-text)
  -> LLM (GPT-4.1-mini or Gemini, with function calling)
  -> ElevenLabs TTS (text-to-speech)
  -> Daily WebRTC Output
```

**Session lifecycle:**
- On start: Creates a ModelGuide session via `POST /api/sessions`
- During call: LLM tool calls execute via ModelGuide's MCP endpoint (`POST /mcp/:agentId`)
- On hang up: Posts the full transcript to ModelGuide, then marks the session as completed

**Tool mapping:** The LLM uses short tool names (`list_products`, `add_to_cart`). These are mapped to connector-prefixed MCP names (`buildpro_store_list_products`, `buildpro_store_add_to_cart`) before execution.

## Architecture

```
src/
  bot.py          # Main pipeline wiring and lifecycle
  config.py       # Environment variable loading
  mg_client.py    # ModelGuide REST + MCP client
  tools.py        # Tool schemas and MCP-backed handlers
  prompts.py      # BuildPro "Sam" system prompt
  transcript.py   # In-memory transcript collector
```

## Known limitations

- **Latency:** Each tool call is a network round trip to the ModelGuide MCP server. Pipecat's streaming pipeline mitigates perceived latency, but total latency is higher than a co-located setup. For production, consider deploying the Pipecat agent on the same infrastructure as the ModelGuide API.
- **No interruption during tool calls:** While a tool is executing, the bot cannot be interrupted. This is a limitation of the sequential pipeline design.

## Pipecat Cloud Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions.

### Dockerfile: Why Multi-Stage Build?

The PCC base image (`dailyco/pipecat-base:latest`) contains **0-byte stubs** for Python, pip, and all pre-installed packages. `RUN pip install` during `docker build` silently does nothing. The multi-stage build works around this:

1. **Builder stage** uses a real Python image to install packages
2. **COPY** merges the installed packages into the PCC base image's site-packages
3. PCC replaces the stubs with real binaries at deploy time

Two critical pins in `requirements.txt`:

- **`starlette==0.50.0`** and **`uvicorn==0.40.0`** — must match the PCC base image versions. Without these, COPY overwrites them with newer versions that break PCC's fastapi health check server.
- **`daily-python` is kept** (not uninstalled from builder) — PCC runtime injection of daily-python is unreliable, so we bundle it directly.
