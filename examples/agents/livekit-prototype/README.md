# LiveKit Voice Agent — Prototype

A deliberately tiny LiveKit voice agent that **pulls its system prompt from
ModelGuide at session start**, so iterating in the dashboard → clicking
"Talk to agent" exercises the new prompt without a redeploy.

Built as a POC for the "compile prompt → sync → test" loop the
[`voiceblox`](https://github.com/voiceblox-ai/voiceblox) project popularized.
For a fully-featured reference (workflows, MCP tool catalog, SIP, Langfuse,
hang-up state machine) see the sibling [`livekit-agent`](../livekit-agent/)
directory — this prototype is intentionally a single agent file.

## How it works

```
Dashboard "Talk to agent" click
  └── POST /api/agents/:id/voice-test-token        (existing endpoint)
        └── dispatches LiveKit worker into a fresh room

Worker entrypoint (this code)
  └── GET /api/agents/me/runtime-config            (NEW endpoint)
        └── returns { compiledInstructions, compiledAt, ... }
  └── AgentSession.start(agent=Agent(instructions=compiled_prompt))
  └── Caller hears the agent
```

Auth on `/me/runtime-config` is the agent's own API key (`mgk_…`) —
the agent in scope is implied. No path param, mirroring `/users/me`.

## Stack

| Component | Service |
|-----------|---------|
| Transport | LiveKit WebRTC |
| VAD | Silero |
| Turn detection | English EOU model |
| STT | Deepgram Nova-3 |
| LLM | OpenAI gpt-4.1-mini |
| TTS | ElevenLabs Flash v2.5 |
| Prompt source | `GET /api/agents/me/runtime-config` |

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- A running ModelGuide API
- An **active** voice + LiveKit agent in ModelGuide with a configured
  prompt (compile at least once so `compiledInstructions` is non-null)
- API keys: OpenAI, Deepgram, ElevenLabs
- For local voice dev: a LiveKit server (`livekit-server --dev`)

## Quick start (local)

```bash
cd examples/agents/livekit-prototype

# Install
uv venv && uv pip install -e ".[test]"

# Configure
cp .env.example .env
# fill in MODELGUIDE_API_KEY (from dashboard → Agent → Integration)
# fill in OPENAI / DEEPGRAM / ELEVENLABS keys

# Terminal 1: run a local LiveKit server (see ../livekit-agent README)
livekit-server --dev

# Terminal 2: run the prototype worker
.venv/bin/python src/agent.py dev

# Terminal 3: in ModelGuide dashboard, edit the prompt, click "Compile",
# then click "Talk to agent" — the worker will fetch the new prompt and
# speak with it.
```

### Console mode (text-only)

```bash
.venv/bin/python src/agent.py console
```

Useful for sanity-checking the prompt loop without audio.

## Tests

```bash
.venv/bin/python -m pytest -v
```

Coverage focuses on `mg_client.fetch_runtime_config`:

- happy path returns the compiled prompt verbatim
- uncompiled agents fall back to `FALLBACK_PROMPT` rather than empty
- 401/5xx raise (crash loudly — don't silently serve stale prompts)
- a whitespace-only prompt also falls back

The contract for the `/me/runtime-config` wire format is locked in by
the corresponding Bun unit test
[`runtime-config.test.ts`](../../../modelguide-api/tests/unit/agents/runtime-config.test.ts)
and the integration test in
[`agents.test.ts`](../../../modelguide-api/tests/integration/agents.test.ts).

## Deploy to LiveKit Cloud

```bash
lk agent create        # populates livekit.toml
lk agent deploy        # builds the Dockerfile and ships it
```

Then in the ModelGuide dashboard, set the agent's LiveKit `agentName`
to match `AGENT_NAME` in your `.env`. The dashboard's "Talk to agent"
button will route to this worker.

## What this prototype intentionally leaves out

- **Tools / MCP** — for the talking-loop POC, the LLM has no tools. Adding
  MCP is straightforward (copy `livekit-agent/src/mcp_agent.py`) but
  obscures the "remote prompt" pattern that's the whole point.
- **Transcripts / session messages** — the worker creates a ModelGuide
  session and completes it, but doesn't post transcripts.
- **SIP / outbound calls** — WebRTC only.
- **Langfuse, hang-up state machine, prompt caching** — see the full
  `livekit-agent` example.

When this pattern graduates from POC, the bits above merge back in.

## ADR

See [`docs/decisions/006-livekit-runtime-config-fetch.md`](../../../docs/decisions/006-livekit-runtime-config-fetch.md)
for the design tradeoffs (pull vs. push, where to authenticate, what to
return when the agent has never been compiled).
