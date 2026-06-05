# LiveKit Prompt-POC Voice Agent

Minimal LiveKit voice agent that **pulls its system prompt from ModelGuide at every job dispatch** instead of baking it into the image. Inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox) — one worker, many prompts, no redeploy.

This is the reference implementation for [ADR-015: Dynamic Prompt Loading for LiveKit Voice Agents](../../../docs/decisions/015-livekit-dynamic-prompt-loading.md).

## Why this exists

The production [`livekit-agent`](../livekit-agent/) example (BuildPro "Sam") composes its prompt at build time. Editing the prompt means editing Python, rebuilding the worker, redeploying. That works for one-prompt-per-image deployments but breaks the dashboard's **Compile → Talk to agent** feedback loop.

This POC closes the loop: clicking **Talk to agent** in the dashboard dispatches a worker that fetches the latest `compiledInstructions` from `GET /api/agents/me` before it speaks. No image rebuild, no metadata gymnastics, no drift between voice-test and prod.

```
Dashboard           ModelGuide API           LiveKit Cloud         POC Worker
  │                       │                        │                    │
  ├─ POST /voice-test-token ─►                     │                    │
  │                       ├──── dispatchAgent ─────►                    │
  │                       │                        ├── job dispatched ──►
  │                       │                        │                    │
  │   ◄─── { token, … } ──┤                        │                    │
  │                       │                        │                    │
  ├──── join room ─────────────────────────────────►                    │
  │                       │                        │                    │
  │                       │   ◄── GET /agents/me ──────────────────────┤    ← THE KEY STEP
  │                       ├──── compiledInstructions ──────────────────►
  │                       │                        │                    │
  ├◄══════════ audio ════════════════════════════════════════════════════
```

## What's included

```
src/
├── agent.py        Entry point — LiveKit worker, AgentSession, greeting
├── config.py       Env validation
└── mg_profile.py   Self-profile fetcher (GET /api/agents/me) + prompt resolution

tests/
└── test_mg_profile.py   5 unit tests (httpx MockTransport, no live API)
```

No business logic, no tools, no SOPs — the whole point of the POC is that the prompt-loading mechanism is the only moving part. Once it's proven, fold `mg_profile` into the existing `MCPAgent` base class to give the same dynamic-loading behaviour to tool-using agents.

## Prerequisites

- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/) (or pip)
- A ModelGuide agent with `agentPlatform: livekit` and an API key
- LiveKit credentials (local server or LiveKit Cloud)
- OpenAI, Deepgram, ElevenLabs keys

## Setup

```bash
cd examples/agents/livekit-prompt-poc

# Install
uv sync                                 # or: pip install -e .

# Configure
cp .env.example .env
# Edit .env — MODELGUIDE_API_KEY is the one issued for the agent you want this worker to serve
```

`AGENT_NAME` in `.env` must match `metadata.livekit.agentName` on the agent in the dashboard — that's the LiveKit worker identity the dashboard dispatches to. The `MODELGUIDE_API_KEY` is what scopes the worker to its specific MG agent and lets `GET /api/agents/me` return the right profile.

## Run it

### Console mode (no LiveKit / no audio)

```bash
python src/agent.py console
```

The worker fetches the profile, prints the resolved prompt, and you can chat to it via the terminal. Use this to smoke-test prompt changes without setting up LiveKit.

### Dev mode (browser-driven, "Talk to agent" from the dashboard)

```bash
# Terminal 1 — LiveKit server (local)
livekit-server --dev

# Terminal 2 — the worker
python src/agent.py dev
```

Then in the dashboard:

1. **Compile** the agent's prompt (or edit and re-compile).
2. Click **Talk to agent** on the agent detail page.
3. The worker logs `Loaded prompt for agent X (compiledAt=… length=…)` — confirms it picked up the *just-compiled* prompt, not a stale one.

### Production mode

```bash
python src/agent.py start
```

Runs as a LiveKit Cloud worker, accepting jobs dispatched by the platform.

## Tests

```bash
pip install -e ".[test]"
pytest -v
```

The tests use `httpx.MockTransport` so no live ModelGuide API is required. They cover:

- `fetch_profile` parses a well-formed self-profile response
- `fetch_profile` handles `compiledInstructions: null` (uncompiled agent)
- `fetch_profile` raises `ProfileFetchError` on 401
- `resolve_system_prompt` returns compiled instructions when present
- `resolve_system_prompt` returns a labelled placeholder when not

## End-to-end verification (manual)

There's no CI for the full browser → LiveKit → POC worker → API → audio loop. Verify it manually:

1. Pick an agent in the dashboard with `agentPlatform: livekit`. Set its `metadata.livekit.agentName` to `modelguide-prompt-poc` (the worker's `AGENT_NAME`).
2. Compile a distinctive prompt (e.g. `"You are a pirate. Reply in pirate-speak only."`).
3. Start the worker locally: `python src/agent.py dev`.
4. Click **Talk to agent** in the dashboard.
5. Speak. The agent should respond in pirate-speak.
6. Recompile with a different prompt (e.g. `"You speak only in haiku."`).
7. Hang up, click **Talk to agent** again.
8. Speak. The agent should now respond in haiku — **without any worker restart**.

If steps 5 and 8 produce different personalities from the same worker process, the POC is working.

## Known limitations

- **No tools.** Adding MCP tools means composing `mg_profile` with `mg_client.MCPConnection` — out of scope for the POC.
- **No prompt cache.** Every dispatch fetches from the API. Fine for voice-test; for production traffic, add an in-memory cache with a short TTL.
- **No persona-aware greeting.** The greeting is a static string from `.env`. A more polished version would extract greeting hints from `profile.prompt_config.persona`.
- **No SIP / outbound calls.** The POC focuses on the WebRTC voice-test path. The same `mg_profile` fetcher composes cleanly with the SIP entrypoint from the buildpro example.

## See also

- [ADR-015: Dynamic Prompt Loading for LiveKit Voice Agents](../../../docs/decisions/015-livekit-dynamic-prompt-loading.md)
- [ADR-014: Browser Voice Testing](../../../docs/decisions/014-browser-voice-testing.md)
- [`examples/agents/livekit-agent/`](../livekit-agent/) — the BuildPro production example this POC complements
