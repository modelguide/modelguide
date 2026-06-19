# LiveKit Prototype Voice Agent

A minimal LiveKit voice agent that **reads its system prompt from dispatch metadata at room-join time** — so you can iterate on prompt copy from the ModelGuide dashboard ("Compile → Talk") without rebuilding and redeploying the worker.

This is the worker half of the flow described in [ADR-015](../../../docs/decisions/015-prototype-voice-test-with-inline-prompt.md). The dashboard half is the **"Test latest prompt"** button on the agent detail page; the API endpoint that wires them together is `POST /agents/:id/prototype-voice-test-token`.

> ⚠️ **Prototype only.** The production `livekit-agent` (sibling directory) is the source of truth for real traffic. This worker is intentionally stripped of MCP, SOPs, and tools — it does STT → LLM → TTS with the dispatched prompt and nothing else. Inspiration: [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox).

## How it differs from the production agent

| | `livekit-agent` (production) | `livekit-prototype` (this) |
|---|---|---|
| Prompt source | Baked into worker image, per-profile | Dispatch metadata (compiled in MG) |
| Tool registry | MCP client → `connector_tools` | None |
| Session tracking | Posts transcript on hang-up | Skips — session row is created by the API caller |
| Dispatch mode | `voice-test`, `outbound` | `prototype` (rejects others) |
| Redeploy needed when prompt changes? | Yes | **No** |
| Use it for | Live customer traffic | Tightening prompt copy |

## Quick start

```bash
# 1. Set up Python env
uv venv && source .venv/bin/activate
uv pip install -e ".[test]"

# 2. Configure credentials
cp .env.example .env
# Fill in OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY

# 3. Run unit tests
pytest

# 4. Run worker locally (registers with LiveKit Cloud or local server)
python src/agent.py dev
```

Then in the ModelGuide dashboard:

1. Open an agent (`agentPlatform = livekit`).
2. **Compile** the prompt.
3. Click **Test latest prompt** in the Voice Test panel.
4. The browser joins a `prototype-*` room; this worker is dispatched with the compiled instructions inline; you talk.

## Cloud deploy

`livekit.toml` defines the LiveKit Cloud project. Run:

```bash
lk agent deploy
```

Set the same env vars (`OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`) as Cloud-managed secrets. `AGENT_NAME` must equal the value the MG agent has in `metadata.livekit.agentName`.

## Tests

```bash
pytest
```

The dispatch parser is the load-bearing contract with the API — both sides have parallel tests:

| Side | File |
|---|---|
| API (TypeScript) | `modelguide-api/tests/unit/agents/prototype-voice-test-dispatch.test.ts` |
| Worker (Python) | `tests/test_dispatch.py` |

If either side drifts, the worker rejects the dispatch loudly in its log and the dashboard's 15s connect timeout fires — no silent failures.

## Files

```
src/
  dispatch.py    pure parser for dispatch metadata (no LiveKit deps)
  config.py      env var loading
  agent.py       LiveKit entrypoint — wires STT/LLM/TTS, runs session
tests/
  test_dispatch.py
Dockerfile        same two-stage layout as the production agent
livekit.toml      LiveKit Cloud project descriptor
pyproject.toml    deps + pytest config
.env.example
```

## Why this exists (short version)

ADR-014 deliberately rejected putting prompts in dispatch metadata for the production path — because "tested in voice-test, broken in prod" is a worse failure mode than the redeploy cost. ADR-015 carves out a separate worker (this one) where that trade-off flips: the win of a 5-second compile-and-talk loop outweighs the risk, because nobody is shipping a customer experience through it.

Keeping prototype and production as **two different workers** is the safety boundary. Don't merge them.
