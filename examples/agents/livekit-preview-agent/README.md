# LiveKit Preview Agent (POC)

A minimal LiveKit worker that talks against an **injected compiled prompt** so
operators can hear how a prompt edit sounds *before* promoting it to the
deployed production worker.

This is the worker-side half of the
`POST /api/agents/:id/preview-voice-token` flow. See
[`docs/decisions/015-livekit-preview-prompt-injection.md`](../../../docs/decisions/015-livekit-preview-prompt-injection.md)
for the design rationale and the deliberate divergence from ADR-014
(voice-test, which refuses prompt injection on purpose).

## How it differs from the existing `livekit-agent`

|                   | `livekit-agent` (BuildPro Sam)                    | `livekit-preview-agent` (this) |
| ----------------- | ------------------------------------------------- | ------------------------------ |
| Prompt source     | Baked into the worker (`src/prompts/`)            | `instructions_override` from dispatch metadata |
| Tools             | 11 MCP-backed tools                                | None — preview is about the prompt, not orchestration |
| Profile registry  | Multi-profile, routes on `agentName`              | Single-shot, parses on `mode == "preview"` |
| Production-ready  | Yes                                                | No — POC for prompt iteration only |
| Worker name       | Per-agent (`metadata.livekit.agentName`)          | `preview-worker` (or `metadata.livekit.previewAgentName`) |

## The dispatch contract

The MG API's `buildPreviewDispatchMetadata` (TypeScript) and this worker's
`parse_dispatch_metadata` (Python) are pinned to the same JSON shape:

```json
{
  "mode": "preview",
  "agentName": "<mg-agent-slug>",
  "session_id": "<uuid>",
  "user_identifier": "<caller email>",
  "email": "<caller email>",
  "instructions_override": "<the compiled system prompt>"
}
```

Both sides have pure unit tests asserting the shape. If either side
drifts, dispatched preview rooms go silent.

- API side: `modelguide-api/tests/unit/agents/preview-voice-dispatch.test.ts`
- Worker side: `examples/agents/livekit-preview-agent/tests/test_dispatch.py`

## Quick start (local)

```bash
# 1. Install deps
cd examples/agents/livekit-preview-agent
uv sync   # or: pip install -e .

# 2. Configure environment
cp .env.example .env
# fill in LIVEKIT_*, OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY

# 3. Start the worker
python src/agent.py dev
```

Then in the dashboard:

1. Navigate to **Agents → \<voice agent\> → Prompt**.
2. Click **Compile Prompt** (or **Recompile**) so the compiled instructions
   are fresh.
3. Click **Sync & Talk** in the *Compiled Prompt* card.
4. Allow mic, start talking. The agent uses the freshly compiled prompt
   as its system prompt — no redeploy needed.

## Testing

```bash
pytest               # unit tests for the dispatch parser
```

The dispatch parser is a pure function and is fully covered offline. The
LLM/STT/TTS pipeline requires real provider credentials and a running
LiveKit server — those are exercised by the manual flow above, not in
CI.

## Limits

- **Single LLM/STT/TTS stack** — OpenAI + Deepgram + ElevenLabs. The point
  of preview is to iterate on the prompt, not the provider stack. If you
  need to test a different stack, add a sibling worker (this POC stays
  intentionally small).
- **No MCP / tools** — preview only exercises conversational behaviour.
  Tool-call regressions are caught by the eval suite, not by talking to
  the agent.
- **No session transcript** — the MG session row is created by the API, but
  this worker does not call `core_add_messages` (no MCP). The transcript
  shows the session but no turns. Acceptable trade-off for a POC; revisit
  if preview becomes load-bearing.
- **Single concurrent preview per LiveKit project** — the worker accepts
  any preview dispatch addressed to its `AGENT_NAME`. If you need parallel
  previews under different model/voice configs, run multiple instances
  with distinct `AGENT_NAME` values and set
  `metadata.livekit.previewAgentName` per MG agent.

## Layout

```
examples/agents/livekit-preview-agent/
├── pyproject.toml
├── README.md
├── .env.example
├── src/
│   ├── __init__.py
│   ├── agent.py        # WorkerOptions + entrypoint
│   ├── config.py       # env loading + validation
│   └── dispatch.py     # parse_dispatch_metadata (the contract)
└── tests/
    ├── __init__.py
    └── test_dispatch.py
```
