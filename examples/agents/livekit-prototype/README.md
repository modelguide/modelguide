# LiveKit Prototype Worker

A minimal LiveKit voice agent that reads its **system prompt from dispatch
metadata**. Pair it with the dashboard's **Prototype Voice Test** panel to get
a one-click "compile prompt → sync → talk" loop without redeploying.

> See [ADR-015](../../../docs/decisions/015-prototype-prompt-injection.md) for
> the design rationale and the trade-off versus the production voice-test
> flow ([ADR-014](../../../docs/decisions/014-browser-voice-testing.md)).
> Inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox).

## How it differs from `livekit-agent/`

| Aspect | `livekit-agent/` (production) | `livekit-prototype/` (this) |
|---|---|---|
| Prompt source | Baked into worker image (per-profile) | `dispatch_metadata["instructions"]` |
| Tools / MCP / SOPs | Yes | No — pure prompt |
| Audience | Deployed agents in prod traffic | Prompt iteration during dev |
| Deploy frequency | Slow (image build) | Never — dispatch carries the prompt |

## Wire contract

The MG API endpoint `POST /api/agents/:id/prototype-voice-test-token`
JSON-encodes the dispatch payload. The worker decodes it in
`prototype_agent.metadata.parse_dispatch_metadata`:

```json
{
  "mode":            "voice-test-prototype",
  "agentName":       "<agent slug>",
  "instructions":    "<compiled system prompt>",
  "session_id":      "<modelguide session uuid>",
  "user_identifier": "<caller email>",
  "email":           "<caller email>"
}
```

Both sides have unit-test coverage of this contract:

- API: `modelguide-api/tests/unit/agents/prototype-voice-test-dispatch.test.ts`
- Worker: `tests/test_metadata.py`

If you rename or reshape a field, **both** test files break — that's the
point.

## Local development

Prerequisites: Python ≥3.11, [`uv`](https://github.com/astral-sh/uv) (or pip),
a LiveKit Cloud project (or self-hosted server), and an OpenAI API key.

```bash
# From the repo root
cd examples/agents/livekit-prototype

# Install (uv preferred)
uv venv && uv pip install -e ".[test]"

# Required env
export LIVEKIT_URL="wss://<project>.livekit.cloud"
export LIVEKIT_API_KEY="…"
export LIVEKIT_API_SECRET="…"
export OPENAI_API_KEY="sk-…"
# Optional: agent name registered with the LiveKit dispatcher
export PROTOTYPE_AGENT_NAME="modelguide-prototype"

# Run tests
pytest

# Run the worker (development mode — hot reload)
python -m prototype_agent.agent dev

# Run the worker (production mode)
python -m prototype_agent.agent start
```

The worker registers itself with LiveKit Cloud under
`PROTOTYPE_AGENT_NAME`. Configure the same value as the agent's
`metadata.livekit.agentName` in ModelGuide and the dispatcher will route
prototype voice-test requests to it.

## Cloud deployment

Build the image and push to your registry:

```bash
docker build -t <registry>/modelguide-livekit-prototype:latest .
docker push <registry>/modelguide-livekit-prototype:latest
```

Deploy to Railway, Fly.io, Render, or any platform that runs a long-lived
container. Required env vars at runtime:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `PROTOTYPE_AGENT_NAME` (optional; defaults to `modelguide-prototype`)
- `PROTOTYPE_LLM_MODEL` (optional; defaults to `gpt-4o-mini`)

The worker pre-downloads Silero VAD weights at image build time so cold
starts are quick.

## End-to-end test loop (manual)

1. Configure a LiveKit voice agent in ModelGuide with
   `metadata.livekit.agentName` matching `PROTOTYPE_AGENT_NAME` above.
2. Activate the agent (`isActive: true`).
3. Compile it once so `compiled_instructions` is non-null
   (`POST /api/agents/:id/compile`, or the **Compile** button on the SOP page).
4. Open the agent detail page. The **Prototype Voice Test** card appears
   below the production Voice Test card.
5. Click **Sync & test prompt**. The dashboard:
   - Asks for mic permission.
   - Re-runs the compiler.
   - Dispatches this worker with the freshly compiled prompt in metadata.
   - Joins the room over WebRTC.
6. Talk. Edit the prompt. Click **Sync & test again**. The next dispatch
   carries the updated text — no redeploy.

## File layout

```
examples/agents/livekit-prototype/
├── README.md            (this file)
├── Dockerfile           (uv-based multi-stage build)
├── pyproject.toml
├── src/
│   └── prototype_agent/
│       ├── __init__.py
│       ├── agent.py      (LiveKit entrypoint)
│       └── metadata.py   (dispatch-metadata parser — the contract)
└── tests/
    ├── __init__.py
    └── test_metadata.py  (11 tests — happy path + every error mode)
```
