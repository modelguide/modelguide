# livekit-poc — prompt-driven LiveKit voice agent

A minimal LiveKit voice agent that reads its system prompt from the
LiveKit dispatch metadata. Wired so the "Talk to agent" button in the
ModelGuide dashboard delivers the **latest compiled prompt** without a
worker redeploy — the tight feedback loop the public website demo
already has, ported to the platform itself.

> Status: **prototype**. Don't run this as your production voice agent
> — use [`examples/agents/livekit-agent`](../livekit-agent/) for that.
> See [ADR-015](../../../docs/decisions/015-livekit-poc-prompt-from-dispatch.md)
> for what's load-bearing here and what's deliberately left simple.

## What's in the box

```
src/
  agent.py             entrypoint — wires AgentSession + OpenAI Realtime
  config.py            env validation
  prompt_resolver.py   override > dispatch metadata > default
  dispatch_context.py  parses session_id / user / agent_name from metadata
  transcript.py        in-memory transcript, payload-shaped for MG REST
  mg_client.py         best-effort transcript POST + session completion
tests/
  test_prompt_resolution.py   prompt resolution rules (17 cases)
  test_dispatch_context.py    metadata parsing (10 cases)
  test_transcript.py          transcript shape (7 cases)
```

Everything is small on purpose. The interesting bit is the contract
between the API's `buildVoiceTestDispatchMetadata` and this agent's
`resolve_instructions` — two test files lock that contract end-to-end.

## How the dashboard flow works

```
Dashboard "Talk to agent" click
  └─> POST /api/agents/:id/voice-test-token              (modelguide-api)
        ├─ creates a ModelGuide session
        ├─ dispatches the configured LiveKit worker with metadata:
        │     {
        │       "mode": "voice-test",
        │       "agentName": "<agent.slug>",
        │       "session_id": "<mg session>",
        │       "user_identifier": "<caller email>",
        │       "email": "<caller email>",
        │       "instructions": "<compiled prompt, if present>"  ← ADR-015
        │     }
        └─ mints a short-lived LiveKit AccessToken
  └─> Browser joins the LiveKit room via WebRTC
  └─> Worker (this POC) starts an AgentSession with the resolved prompt
```

The `instructions` field is the new bit. The production
`buildpro` worker ignores it (its prompt is baked in); this POC reads
it. Workers self-opt-in by checking the field — there's no flag, no
toggle, no breaking change on the API side.

## Local dev loop

From the **repo root**:

```bash
# 1. One-time setup
cd examples/agents/livekit-poc
python -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
cp .env.example .env  # then edit with your OpenAI key

# 2. Start a local LiveKit server (uses devkey/secret defaults)
make -C ../../.. livekit-up   # native LiveKit (brew install)
# or:
make -C ../../.. livekit-up-docker

# 3. Start the agent
python src/agent.py dev

# 4. From a separate terminal, dispatch the agent into a room with an
#    explicit instructions override and join from meet.livekit.io:
lk dispatch create \
  --agent-name livekit-poc \
  --room poc-test-1 \
  --metadata '{"instructions": "You are a haiku poet. Reply in haiku."}'

# Then open https://meet.livekit.io, paste a token from `lk token create`,
# and start talking.
```

When the dashboard wires this up automatically (see "Wiring into the
dashboard" below), the dispatch + token mint happen for you and you just
click **Talk to agent**.

## Wiring into the ModelGuide dashboard

The POC slots in as a normal LiveKit-platform agent. To test it from the
dashboard:

1. Create a voice agent on the LiveKit platform.
2. On the agent detail page → **LiveKit card** → **Configure LiveKit**:
   - **URL**: your LiveKit Cloud (or `ws://localhost:7880` for local)
   - **Agent Name**: `livekit-poc` (matches `AGENT_NAME` in `.env`)
   - **LiveKit API Key / Secret**: secret refs
3. **Slug**: leave as auto-generated. The POC doesn't currently route on
   `agentName` from metadata, so any slug works.
4. Open the prompt compiler, write a prompt, click **Compile**.
5. Open the **Voice Test** panel and click **Talk to agent**.

The worker logs `Prompt resolved: source=dispatch_metadata len=…` at
session start. If you see `source=default` instead, the agent has no
compiled prompt yet — compile one and try again.

## Tests

```bash
cd examples/agents/livekit-poc
python -m pytest                # 34 tests, ~0.05s
```

The unit tests cover the meaningful logic and run without LiveKit
installed (the imports of `livekit.*` only happen inside `agent.py`,
which is not import-time loaded by the test suite). End-to-end voice
verification is operator-driven — start the worker against a real
LiveKit server and listen.

## Why this is separate from `livekit-agent/`

The production agent ([`examples/agents/livekit-agent`](../livekit-agent/))
ships:

- 11 MCP-backed tools wired into the BuildPro contractor-supply demo
- Deepgram STT + GPT + ElevenLabs TTS chain
- Langfuse tracing, SIP support, transcript collector, hangup state
  machine, etc.

None of that helps when the goal is "type a new prompt and hear how it
sounds". The POC strips the agent down to the absolute minimum — one
SDK call to OpenAI Realtime, one prompt — so the iteration loop is
under five seconds from "Compile" to "audio out of the speakers".

If the POC graduates, the resolution logic in `prompt_resolver.py`
ports cleanly into `livekit-agent/src/mcp_agent.py` as a constructor
parameter on `MCPAgent`. Nothing else needs to move.

## Related

- [ADR-014: Browser Voice Testing via LiveKit Dispatch](../../../docs/decisions/014-browser-voice-testing.md)
- [ADR-015: livekit-poc — Prompt from Dispatch Metadata](../../../docs/decisions/015-livekit-poc-prompt-from-dispatch.md)
- [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox) —
  layout inspiration for a small, prompt-driven voice agent.
- [`examples/agents/livekit-agent`](../livekit-agent/) — the production
  multi-tool agent this POC is paired against.
