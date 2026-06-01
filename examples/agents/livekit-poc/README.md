# livekit-poc

Minimal LiveKit voice agent for ModelGuide. Click **Talk to agent** in the
dashboard, the dispatched worker uses the prompt you compiled seconds ago,
no redeploy in between.

Inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox)
(single-purpose voice agent boilerplate). For the design rationale — why this
exists alongside the larger `livekit-agent/` stack — see
[ADR-015](../../../docs/decisions/015-livekit-poc-prompt-injection.md).

## What it is (and isn't)

| | livekit-poc | livekit-agent |
|---|---|---|
| Tools / MCP | none | full ModelGuide MCP |
| System prompt | from dispatch metadata, fallback to default | baked in at image build |
| SOP awareness | none | full SOP-compiled prompt + workflows |
| Files | 4 source files | ~10 source + workflow modules |
| Use case | prototype prompts, smoke-test the platform | production scenarios |

This worker exists to close the loop on **"edit prompt → click Talk →
hear the new prompt."** Nothing else.

## Flow

```
dashboard "Talk to agent"
  → POST /agents/:id/voice-test-token
      → loads agent.compiledInstructions from DB
      → AgentDispatchClient.createDispatch(roomName, agentName, metadata={
            mode: "voice-test",
            agentName: <slug>,
            instructions: <fresh compiled prompt>,
            greeting?: <optional opener>,
            ...
        })
  → livekit-poc worker entrypoint reads ctx.job.metadata
      → parse_dispatch_metadata() → DispatchMetadata
      → choose_instructions(md) → either dispatched prompt or DEFAULT_INSTRUCTIONS
      → Agent(instructions=...) → AgentSession (STT/LLM/TTS) → say(greeting)
  → browser <LiveKitRoom> renders agent audio
```

## Local dev

```bash
cd examples/agents/livekit-poc
cp .env.example .env
# Edit .env with your OpenAI / Deepgram / ElevenLabs keys

# Install deps (creates a local venv if you want one)
pip install -e ".[test]"

# Run the tests
pytest -q
```

To run a real WebRTC session locally you need a LiveKit server. The
existing repo Makefile already has helpers — they work for this worker
too, you just point the `--agent` flag at `livekit-poc`:

```bash
# Terminal 1 — LiveKit dev server
make livekit-up                # or: make livekit-up-docker

# Terminal 2 — POC worker
python src/agent.py dev

# Terminal 3 — join the room
lk token create \
  --api-key devkey --api-secret secret \
  --join --room test --identity me \
  --agent-name livekit-poc \
  --valid-for 24h
```

### Console mode (no LiveKit needed)

```bash
python src/agent.py console
```

Types text in, get LLM responses out. Useful for tweaking the default
prompt without spinning up STT/TTS.

## Wiring this worker to a ModelGuide agent

In the dashboard, on an agent's detail page, set:

| Field | Value |
|---|---|
| Platform | `livekit` |
| `metadata.livekit.url` | `wss://<your-livekit-project>.livekit.cloud` |
| `metadata.livekit.agentName` | `livekit-poc` (must match `LIVEKIT_POC_AGENT_NAME`) |
| `metadata.livekit.injectCompiledPrompt` | `true` ← opt-in flag, see ADR-015 |
| Secret `livekit_api_key` | API key |
| Secret `livekit_api_secret` | API secret |

The `injectCompiledPrompt: true` flag is what tells the API to pass
`agent.compiledInstructions` in dispatch metadata. Without it, the
worker uses its baked-in default (so a misconfigured POC still talks,
just with a generic prompt). Production agents pointed at the
`livekit-agent` worker leave this flag off — see ADR-014 and ADR-015
for why those two paths are separate.

Then click **Compile Prompt**, then click **Talk to agent**. The
dispatched worker will use the prompt from the compile.

## LiveKit Cloud deployment

1. Create the worker on LiveKit Cloud:

   ```bash
   cd examples/agents/livekit-poc
   lk agent create  # walks you through project + agent ID, writes livekit.toml
   ```

2. Push the image (Dockerfile included):

   ```bash
   lk agent deploy
   ```

3. Set the same `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`,
   and `LIVEKIT_POC_AGENT_NAME` env vars in the Cloud dashboard.

## Testing

```bash
pytest -q
```

19 tests, runs in under a second. They cover:

- `tests/test_metadata.py` — parser contract that mirrors the TS-side
  `buildVoiceTestDispatchMetadata` test. If the API ever drifts the field
  names, one of the two suites breaks.
- `tests/test_prompt_selection.py` — "dispatch wins, default fallback"
  rule as executable spec.

The worker itself isn't unit-tested (it's mostly glue around the
LiveKit Agents SDK); the runtime check is **`python src/agent.py console`**
and the local WebRTC flow above.

## Layout

```
src/
  agent.py        # entrypoint — STT/LLM/TTS wiring
  metadata.py     # dispatch metadata parser (DispatchMetadata dataclass)
  prompt.py       # choose_instructions / choose_greeting + defaults
tests/
  test_metadata.py
  test_prompt_selection.py
Dockerfile
livekit.toml      # filled in by `lk agent create`
.env.example
pyproject.toml
```
