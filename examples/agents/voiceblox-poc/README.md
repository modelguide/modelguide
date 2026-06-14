# Voiceblox POC — LiveKit agent that pulls prompts from ModelGuide

A prototype LiveKit voice agent that **fetches its system prompt from
ModelGuide at session start** instead of bundling it at build time.

Inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox).
The buildpro example next door does the full MCP + connector tools dance — this
one strips that out so the loop you're testing is just:

```
edit prompt config / SOPs → Compile Prompt → Talk to agent → speak with the new prompt
```

…in the dashboard, with no worker redeploy in between.

## Why this exists

The buildpro example bakes `prompts/base.py` + `prompts/workflows/*.py` into
the worker image. That's great for production — the prompt is versioned with
the code — but it means dashboard prompt edits don't reach the worker until
the next deploy.

For prototyping (and for the "click Talk to agent and start talking" loop in
the dashboard), we want the opposite trade-off: the prompt lives in
ModelGuide, the worker pulls it at session start, and a recompile takes effect
on the next call. See [ADR-015](../../../docs/decisions/015-livekit-runtime-prompt-pull.md)
for the full rationale and the alternatives we rejected.

## How it works

```
Dashboard → POST /api/agents/:id/voice-test-token
                ↓
            LiveKit Cloud dispatches the worker into a fresh room
                ↓
            entrypoint() → resolve_system_prompt()
                ↓
            GET /api/agents/me  (Bearer mgk_...)
                ↓
            AgentSession boots with compiledInstructions as the system prompt
                ↓
            Browser <LiveKitRoom> joins → caller talks to the agent
```

The worker authenticates as the agent itself (API key `mgk_xxx` scoped to
that agent), so the same worker can serve any agent whose key you give it —
single binary, many agents.

## Quick start (local voice dev)

All commands run from this directory unless noted.

```bash
# 1. Install deps
uv sync   # or: pip install -e ".[test]"

# 2. Set up env
cp .env.example .env
# Edit .env with your OpenAI, Deepgram, ElevenLabs, and ModelGuide creds.
# The MODELGUIDE_API_KEY must be scoped to the agent you want to talk to.
```

Then in three terminals from the **repo root**:

```bash
# Terminal 1 — LiveKit server (any of these work)
make livekit-up               # native (brew install livekit)
make livekit-up-docker        # Docker (no brew needed)

# Terminal 2 — Voiceblox worker
cd examples/agents/voiceblox-poc
python src/agent.py dev

# Terminal 3 — Join the room
make livekit-token NAME=tester
```

Click **Join** in the browser, allow mic access, and talk to your agent.
The prompt it uses is whatever's in the **Compiled** tab on the agent page
at the moment you joined.

### Console mode (text-only)

Faster iteration when you don't need audio:

```bash
python src/agent.py console
```

### Production worker

```bash
python src/agent.py start
```

Runs as a LiveKit Cloud worker accepting dispatches against `AGENT_NAME`.

## Dashboard flow

This is what you do day-to-day once the worker is deployed:

1. Open the agent's detail page (`/agents/:id`)
2. Edit **Configuration → Persona / Language / Filler phrases**, or assign / edit SOPs
3. Click **Compile Prompt** → the dialog runs the compiler and stores
   `compiledInstructions` on the agent
4. Click **Talk to agent** in the Voice Test panel
5. Allow mic access; talk

Step 4 calls `POST /agents/:id/voice-test-token`, which dispatches the worker
into a fresh room. The worker's entrypoint immediately calls `GET /agents/me`,
gets the prompt you just compiled, and you're in the conversation. No worker
redeploy, no "sync" step — the prompt is always one fetch away from current.

If you haven't compiled yet, the agent falls back to `DEFAULT_PROMPT` and
warns in the logs. Same fallback if ModelGuide is down at the moment of boot —
the call still connects, just with a generic assistant on the other end.

## Architecture

```
src/
  agent.py             # CLI entry, LiveKit session lifecycle
  config.py            # Env vars + validate()
  mg_client.py         # Shared httpx pool, fetch_agent_config, sessions
  providers.py         # STT (Deepgram) + TTS (ElevenLabs) factories
  voiceblox_agent.py   # resolve_system_prompt + build_greeting

tests/
  conftest.py          # Dummy env + sys.path setup
  test_mg_client.py    # fetch_agent_config contract
  test_agent.py        # Prompt resolution + fallback behavior
```

### What you get for free

- **Single-source prompts.** The dashboard is the source of truth. Workers
  pull, never bundle.
- **Multi-agent on one worker.** Each `MODELGUIDE_API_KEY` is scoped to a
  single agent, so deploying N workers with N different keys gives you N
  agent profiles on the same Docker image.
- **Graceful degradation.** API down? Agent uncompiled? Default prompt fires
  and the call still connects.

### What this deliberately does NOT do

- **No connector tools.** Adding tools means MCP plumbing — see the buildpro
  example. For prototyping a prompt, tools are a distraction.
- **No SIP / phone numbers.** Browser WebRTC only. Outbound calls are an
  orthogonal concern.
- **No Langfuse tracing.** Easy to add (`from tracing import setup_langfuse`
  in `agent.py`), left out to keep the POC tiny.
- **No prompt caching.** Every session pays one round-trip to MG. With API
  in the same region this is ~50ms; if it ever matters, cache the last-known
  prompt on disk and stale-while-revalidate.

## Tests

```bash
pytest tests/
```

12 tests, runs in <1 second, no Docker required. The tests pin:

- `GET /api/agents/me` contract (URL, auth header, response shape)
- Fallback behavior (uncompiled agent, fetch error)
- Persona / language appending from `promptConfig`
- Session create / complete happy paths

When you change `mg_client.fetch_agent_config()` or the resolution rules in
`voiceblox_agent.resolve_system_prompt()`, update the tests in the same diff.

## Deploying to LiveKit Cloud

```bash
# 1. Create the agent shell (one-time)
cd examples/agents/voiceblox-poc
lk agent create --name voiceblox-poc

# 2. Wire MODELGUIDE_API_KEY + provider keys as LiveKit secrets
lk agent update --secrets-file .env

# 3. Build + push
lk agent deploy
```

On the ModelGuide side:

1. Generate an API key on the agent's detail page
2. Set `MODELGUIDE_API_KEY` in the LiveKit secrets to that value
3. Configure LiveKit on the agent: URL (`wss://<subdomain>.livekit.cloud`),
   agentName (`voiceblox-poc`), and the LiveKit API key + secret in the agent's
   secrets table
4. Activate the agent and click **Talk to agent**
