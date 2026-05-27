# LiveKit Prompt-Test Agent

A lean LiveKit voice agent that **fetches its system prompt from ModelGuide on every session**. Inspired by [voiceblox](https://github.com/voiceblox-ai/voiceblox): one prompt, no business logic, instant feedback loop.

The point of this worker is the dashboard loop it unlocks:

> **Compile prompt** → **click "Talk to agent"** → **hear the prompt you just compiled** — no worker redeploy needed.

The existing [`livekit-agent/`](../livekit-agent/) (BuildPro Sam) bakes its prompt into the image. That's the right shape for production agents with custom tools and guardrails, but it makes prompt iteration painful — every tweak needs a deploy. This prototype trades the bakedness for liveness.

## What's in the box

| File | Job |
|------|-----|
| `src/prompt_loader.py` | Calls `GET /api/agents/me` with the worker's API key, returns the live `compiledInstructions`. Falls back to a verbose default if the API is unreachable or no prompt is compiled. |
| `src/dynamic_agent.py` | Thin `livekit.agents.Agent` subclass — instructions arrive at construction time. No tools, no hooks. |
| `src/mg_client.py` | REST client for session create/complete + transcript submission. |
| `src/main.py` | Worker entrypoint: parse dispatch metadata → fetch prompt → run `AgentSession` → post transcript on close. |
| `src/providers.py` | STT/TTS factories (Deepgram, ElevenLabs, Cartesia). |
| `src/config.py` | Env-var loading + validation. |
| `tests/` | Unit tests against `httpx.MockTransport` — no network, no LiveKit required. |

## Stack

| Component | Service |
|-----------|---------|
| Transport | LiveKit Cloud WebRTC |
| VAD | Silero |
| Turn detection | English EOU model |
| STT | Deepgram Nova-3 |
| LLM | OpenAI GPT-4.1-mini |
| TTS | ElevenLabs Flash v2.5 (or Cartesia) |
| Prompt | **Fetched live from `GET /api/agents/me`** |
| Tools | None (yet — see "Adding tools" below) |

## Prerequisites

- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- API keys for OpenAI, Deepgram, and ElevenLabs
- A running ModelGuide API with an active agent that has:
  - A `mgk_*` API key (created with the agent)
  - LiveKit configured (URL, API key/secret, **Agent Name = `modelguide-prompt-test`** — or whatever you set in `AGENT_NAME` below)
  - A compiled prompt (Prompt → Compile in the dashboard)

## Quick start (local)

```bash
cd examples/agents/livekit-prompt-test-agent
uv venv && uv pip install -e .
cp .env.example .env
# Edit .env with your API keys + the agent's mgk_* key
```

Then in three terminals:

```bash
# Terminal 1 — local LiveKit server
livekit-server --dev

# Terminal 2 — the worker
uv run python src/main.py dev

# Terminal 3 — from the ModelGuide dashboard, open the agent detail page
# and click "Talk to agent" in the Voice Test panel.
```

When the worker boots it logs:

```
agent | INFO | modelguide-prompt-test prompt-test agent v0.1.0 — entrypoint called
agent | INFO | Participant joined: user-...
prompt_loader | INFO | Loaded compiled prompt for agent <slug> (<id>, NNNN chars)
```

That last line is the proof the prompt came from ModelGuide — not from disk.

### Text-only console mode (no WebRTC)

```bash
uv run python src/main.py console
```

Useful for sanity-checking the prompt fetch without an audio pipeline.

## How the dashboard loop works

1. **Operator** edits the SOP / prompt config in the dashboard.
2. **Operator** clicks **Compile** in the Prompt section → `POST /api/agents/:id/compile` persists `compiledInstructions` on the agent row.
3. **Operator** clicks **Talk to agent** in the Voice Test panel.
4. **Dashboard** calls `POST /api/agents/:id/voice-test-token` — ModelGuide creates a session, dispatches a worker registered under the agent's configured `agentName`, and returns a short-lived LiveKit token.
5. **Worker** boots, calls `GET /api/agents/me` with its own `mgk_*` API key, reads the *just-compiled* `compiledInstructions`, and passes them to the LLM.
6. **Operator** hears the new prompt within ~2 seconds of the click.

This works because (5) happens on **every session**, not at worker startup. There's no in-memory cache to invalidate, no deploy to wait for.

## Configuration

All env vars are documented in `.env.example`. The two non-obvious ones:

- **`AGENT_NAME`** — the LiveKit worker registers itself under this name. The ModelGuide agent's "LiveKit → Agent Name" must match, or the voice-test dispatch will timeout silently (the room stays empty for 15 seconds, then the browser gives up).
- **`MODELGUIDE_API_KEY`** — this is the `mgk_*` key shown when the ModelGuide agent was created. The worker authenticates as this agent for `GET /api/agents/me`. **One worker = one agent.** If you want one worker process to serve multiple ModelGuide agents (multi-profile), look at the buildpro example for the routing pattern.

## Adding tools

This prototype is prompt-only. To add MCP tools (`add_to_cart`, etc.), follow the buildpro pattern:

1. Subclass `DynamicAgent` with `@function_tool` methods.
2. Import an `MCPConnection` from a copy of `livekit-agent/src/mg_client.py` (the streamablehttp_client bits).
3. Open the connection during entrypoint, pass it into your subclass, route each `@function_tool` to `mcp.call_tool(...)`.

We deliberately left that out of the prototype so the diff stays small and the prompt-fetching story stays the headline.

## Deployment

LiveKit Cloud (one-time):

```bash
lk cloud auth login
lk agent create   # writes livekit.toml — commit the project/agent IDs
lk agent update-secrets \
  OPENAI_API_KEY=sk-... \
  DEEPGRAM_API_KEY=... \
  ELEVENLABS_API_KEY=... \
  MODELGUIDE_API_URL=https://your-mg.up.railway.app \
  MODELGUIDE_API_KEY=mgk_your-agent-key \
  AGENT_NAME=modelguide-prompt-test
lk agent deploy
```

After that, every `lk agent deploy` ships the **worker** — your **prompt** lives in the database and updates the moment you hit Compile.

## Tests

```bash
uv run pytest               # all tests (~0.1s)
uv run pytest -k loader     # just the prompt-loader tests
```

The tests run without LiveKit installed (the agent module has a defensive import). They cover:

- `prompt_loader.fetch_agent_profile` — request shape, success, 401/500/transport failures
- `prompt_loader.load_prompt` — happy path + every fallback case
- `dynamic_agent.DynamicAgent` — construction without I/O, transcript isolation

Tool execution is not covered (no tools yet).

## Related

- [ADR-014](../../../docs/decisions/014-browser-voice-testing.md) — the voice-test dispatch endpoint this worker is dispatched into.
- [ADR-015](../../../docs/decisions/015-dynamic-prompt-livekit-agent.md) — why this prototype exists and how it deviates from ADR-014's "no prompt injection" stance.
- [`../livekit-agent/`](../livekit-agent/) — the production-shape BuildPro Sam example with MCP tools and baked prompts.
