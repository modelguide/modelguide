# voiceblox-agent

A minimal LiveKit voice agent prototype for ModelGuide, inspired by [voiceblox](https://github.com/voiceblox-ai/voiceblox).

This agent exists to demonstrate one thing: a tight **compile → test → talk** loop. The system prompt is pulled from the ModelGuide API on every session start, so edits made in the dashboard go live with the next call. No code redeploy, no rebuild, no SOP file syncs.

For the production-grade reference agent (with MCP tool calls, SIP, multi-profile workers, full tracing), see [`../livekit-agent`](../livekit-agent/). The two agents are complementary, not alternatives.

## How it differs from `livekit-agent`

| Aspect | `livekit-agent` (production) | `voiceblox-agent` (prototype) |
|---|---|---|
| Prompt source | Baked into worker image (`src/prompts/`) | Fetched from `GET /api/agents/me/runtime` at session start |
| Tools | MCP-backed `@function_tool` methods | None — conversational only |
| Multi-profile | Yes (one worker, N agents via dispatch metadata) | No — one worker = one agent |
| SOP integration | Code-managed prompt modules | Dashboard-managed compiled prompt |
| Lines of Python | ~1,500 | ~500 |
| Deployment target | LiveKit Cloud, multi-tenant | LiveKit Cloud, single-tenant prototypes |

The architectural rationale lives in [ADR-015](../../../docs/decisions/015-runtime-prompt-fetch.md).

## Quick start (local dev)

All commands run from this directory unless noted.

```bash
# 1. Install
uv venv .venv
uv pip install --python .venv/bin/python -e ".[test]"

# 2. Configure
cp .env.example .env
# Edit .env with your API keys (OpenAI, Deepgram, ElevenLabs, ModelGuide)

# 3. Smoke-test the prompt + client logic without booting LiveKit:
.venv/bin/python -m pytest

# 4. Text-only console mode (no WebRTC needed)
.venv/bin/python src/agent.py console

# 5. Full WebRTC dev mode (local LiveKit)
#    Terminal 1: livekit-server --dev
#    Terminal 2 (this one):
.venv/bin/python src/agent.py dev
```

Open <https://meet.livekit.io>, paste your local LiveKit URL + a token (see [`make livekit-token`](../../../Makefile) at the repo root), and you're talking to the agent.

## Talking to the agent from the ModelGuide dashboard

This is the inner loop the agent was built for:

1. Open the agent detail page (`/agents/:id`).
2. **Compile** a prompt from the **Prompt** section (assign one or more SOPs, then **Compile**).
3. Click **Talk to agent** in the **Voice Test** card. The dashboard:
   - mints a short-lived LiveKit access token
   - dispatches *this* worker into a fresh `voice-test-<nanoid>` room
   - opens a WebRTC connection from the browser
4. On `entrypoint()`, this agent calls `GET /api/agents/me/runtime` against the ModelGuide API and reads the **just-compiled** instructions. It then greets the caller and starts the conversation.

If you compile a different prompt and click **Talk to agent** again, the new prompt is live on the next call — no worker redeploy needed.

## Configuration

All configuration is via env vars. See `.env.example` for the full list.

| Var | Required | Notes |
|---|---|---|
| `MODELGUIDE_API_URL` | yes | Base URL of your ModelGuide API |
| `MODELGUIDE_API_KEY` | yes | Agent API key (`mgk_...`), shown once at agent creation |
| `OPENAI_API_KEY` | yes | LLM provider |
| `DEEPGRAM_API_KEY` | yes | STT provider |
| `ELEVENLABS_API_KEY` | yes¹ | TTS provider |
| `AGENT_NAME` | no | LiveKit worker identity. Default `voiceblox-prototype`. |
| `LLM_MODEL` | no | Default `gpt-4.1-mini` |
| `ELEVENLABS_VOICE_ID` | no | Default `iP95p4xoKVk53GoZ742B` |
| `VOICEBLOX_GREETING` | no | Spoken greeting template — must include `{name}` |

¹ Required when `TTS_PROVIDER=elevenlabs`, which is the default.

## Deployment

The included `Dockerfile` builds a container that runs the agent as a LiveKit Cloud worker:

```bash
# Build
docker build -t voiceblox-modelguide-agent .

# Deploy to LiveKit Cloud (after `lk agent create` to seed livekit.toml)
lk agent deploy
```

Each deployment is a single ModelGuide agent (identified by its API key). To run another agent, deploy a second worker with a different `AGENT_NAME` and `MODELGUIDE_API_KEY`.

## Architecture

```
LiveKit Cloud Room (WebRTC)
  ↕
AgentSession
  ├── Silero VAD
  ├── EnglishModel (turn detection)
  ├── Deepgram Nova-3 STT
  ├── OpenAI GPT-4.1-mini LLM
  └── ElevenLabs Flash v2.5 TTS
  ↕
VoicebloxAgent (instructions only — no @function_tool methods)
  ↕
mg_client (REST)
  ↕
ModelGuide API
  ├── GET /api/agents/me/runtime    (system prompt on session start)
  ├── POST /api/sessions             (session attribution)
  ├── POST /api/sessions/:id/messages (transcript)
  └── PATCH /api/sessions/:id        (close out)
```

## Failure modes

| What happens | What the agent does |
|---|---|
| Operator never compiled a prompt | Uses `config.FALLBACK_PROMPT` (a "not configured" message) and tells the caller to come back later. |
| `GET /me/runtime` returns 401 / 403 | Logs `exception`, falls back to the canned prompt and still greets the caller — no dead air. |
| `POST /sessions` fails | The conversation continues without session attribution. Transcript not stored. |
| `PATCH /sessions/:id` fails on hangup | Logged. The conversation is unaffected. |

The prompt-fetch and session-create failures are silenced specifically so a brief MG API outage doesn't translate into a silent room — the agent always greets the caller.

## Tests

```bash
.venv/bin/python -m pytest
```

The suite covers the two contract surfaces that matter:

* `tests/test_prompt.py` — the rules for which prompt is used and how runtime context is spliced in. These tests are the regression net for the "compile → talk" loop.
* `tests/test_mg_client.py` — locks in the `GET /me/runtime` response shape so a field rename on the API side doesn't silently break the agent.

The full LiveKit pipeline (STT → LLM → TTS) is not unit-tested here — that path is covered by integration runs against a real LiveKit server.
