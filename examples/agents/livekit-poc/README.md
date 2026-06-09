# LiveKit POC: Dynamic Prompt Loading

A minimal LiveKit voice agent that closes the "edit prompt → compile → talk to agent" loop in the ModelGuide dashboard. The worker fetches its compiled prompt from `GET /api/agents/me/runtime-config` at the start of every session, so prompt edits go live without a redeploy.

Inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox), built on top of the existing `examples/agents/livekit-agent` patterns.

## Why a separate POC

The production agent (`examples/agents/livekit-agent`) ships the prompt + tools as part of the worker image — that's the "ship a profile" model documented in [ADR-014](../../../docs/decisions/014-browser-voice-testing.md). It's the right shape for a deployed agent because the prompt is reviewed, versioned, and tied to the image tag.

But for prompt iteration you want the opposite: the worker is fixed and the prompt floats. This POC is the floating-prompt half. See [ADR-015](../../../docs/decisions/015-dynamic-prompt-loading.md) for the rationale and tradeoffs.

| | Production (`livekit-agent`) | POC (`livekit-poc`) |
|---|---|---|
| Prompt source | Baked into worker image | `GET /api/agents/me/runtime-config` at session start |
| Tools | MCP, full e-commerce stack | None — conversation only |
| When to use | Customer-facing voice agent | Prompt iteration, demos, smoke tests |

## Workflow

1. Edit `Persona`, `Language`, or `Filler phrases` in the agent's **Prompt** card in the dashboard.
2. Click **Compile Prompt** in the **Compiled** tab.
3. Click **Talk to agent** in the **Voice Test** card.
4. The dashboard dispatches this worker into a fresh LiveKit room. The worker hits `GET /api/agents/me/runtime-config`, picks up the new compiled prompt, and runs it.

No code change. No redeploy. The next session uses whatever was compiled last.

## Stack

| Component | Service |
|-----------|---------|
| Transport | LiveKit Cloud WebRTC |
| VAD | Silero |
| Turn Detection | End-of-Utterance Model (Deepgram nova-3 path) |
| STT | Deepgram Nova-3 |
| LLM | OpenAI GPT-4.1-mini |
| TTS | ElevenLabs Flash v2.5 (default) or Cartesia Sonic-3 |
| Prompt source | ModelGuide `GET /api/agents/me/runtime-config` |

## Quick Start (local)

```bash
# 1. Install deps + download Silero VAD / turn-detector models
cd examples/agents/livekit-poc
uv venv .venv
uv pip install --python .venv/bin/python -e .
.venv/bin/python -c "from livekit.plugins.silero import VAD; VAD.load()"

# 2. Configure environment
cp .env.example .env
# Edit .env with OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY,
# MODELGUIDE_API_URL, MODELGUIDE_API_KEY (the agent's mgk_* key)
```

Then open three terminals:

```bash
# Terminal 1 — LiveKit server (Docker) or `livekit-server --dev`
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev

# Terminal 2 — POC voice agent
cd examples/agents/livekit-poc
.venv/bin/python src/agent.py dev

# Terminal 3 — generate a token + open meet.livekit.io
lk token create \
  --api-key devkey --api-secret secret \
  --identity tester --room poc-test \
  --agent modelguide-poc \
  --join meet.livekit.io
```

### Console mode (text-only, no LiveKit needed)

```bash
.venv/bin/python src/agent.py console
```

Type text, hear the agent reply with whatever compiled prompt it pulled from ModelGuide.

## Architecture

```
src/
  agent.py          # CLI entry point, session lifecycle, runtime-config fetch
  config.py         # Environment variables (AGENT_NAME, API keys, etc.)
  mg_client.py      # HTTP client — fetch_runtime_config, create_session, complete_session
  prompts.py        # build_session_instructions, build_greeting, DEFAULT_PROMPT
  providers.py      # STT / TTS factory functions
tests/
  test_mg_client.py # Locks the API contract (URL, error handling, JSON shape)
  test_prompts.py   # Locks "compiled prompt is verbatim, no merging" invariant
```

The agent boots, opens its mic, and at session start runs:

```python
participant, runtime_config = await asyncio.gather(
    ctx.wait_for_participant(),
    mg_client.fetch_runtime_config(),
)
instructions = build_session_instructions(runtime_config)  # ← compiled prompt verbatim
agent = Agent(instructions=instructions)
```

If the API is unreachable, `fetch_runtime_config()` returns `None` and the agent uses a generic default prompt — better dead-air-free degradation than crashing mid-call.

## Configuring an agent for the POC

In the dashboard:

1. Create a voice agent or pick an existing one.
2. **Platform** card → set `agentPlatform` to `livekit`.
3. **Platform** card → fill in `LiveKit URL`, `agentName` (must match `AGENT_NAME` in this agent's `.env`), `API Key`, `API Secret`.
4. Activate the agent. The dashboard shows the `mgk_*` API key once — put it in `MODELGUIDE_API_KEY` in this agent's `.env`.
5. Edit the prompt and click **Compile**.
6. Click **Talk to agent**. You're talking to a LLM driven by the prompt you just compiled.

## Deploying to LiveKit Cloud

```bash
cd examples/agents/livekit-poc
lk agent create   # follow prompts; writes livekit.toml
lk agent deploy   # builds the Dockerfile, pushes to LiveKit Cloud
```

The deployed worker stays up; prompt changes in the dashboard are picked up by the next session without re-deploying.

## Tests

```bash
cd examples/agents/livekit-poc
.venv/bin/python -m pytest tests/ -v
```

The test suite locks two things:

1. **`mg_client.fetch_runtime_config`** — calls the right URL, returns parsed JSON on 2xx, returns `None` on network errors or 4xx/5xx instead of raising.
2. **`prompts.build_session_instructions`** — compiled instructions are returned verbatim (no merging with `promptConfig`), default fallback kicks in when missing.

If either contract drifts, the loop breaks silently — the worker keeps running but stops using the latest prompt, and the user has no way to tell.

## Limitations (this is a POC)

- **No tools.** Conversation only. To add MCP tools, see how `examples/agents/livekit-agent/src/buildpro.py` builds on `MCPAgent`.
- **No transcript posting.** The session is created and closed but message-by-message transcript posting (like the production agent does in `cleanup`) isn't wired up. Add it from the production agent's `mg_client` if you need transcripts.
- **No SIP.** Browser WebRTC only. The production agent has the full inbound/outbound SIP setup.
- **Default prompt is intentionally generic.** If you're running this POC against an agent that's never been compiled, the LLM will sound like a stock assistant. Compile the prompt first.

## Related

- [ADR-015: Dynamic Prompt Loading](../../../docs/decisions/015-dynamic-prompt-loading.md) — design rationale, tradeoffs, security
- [ADR-014: Browser Voice Testing](../../../docs/decisions/014-browser-voice-testing.md) — the "Talk to agent" dispatch flow this POC plugs into
- [`examples/agents/livekit-agent`](../livekit-agent) — production-shaped voice agent with tools and SIP
