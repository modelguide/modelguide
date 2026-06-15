# LiveKit POC Agent — Runtime Prompt Fetching

A minimal LiveKit voice agent that fetches its system prompt from ModelGuide **at session start**, so you can edit a persona / SOP in the dashboard, click *Compile* + *Talk to agent*, and immediately hear the new prompt — no worker redeploy, no metadata injection.

This is the prototype companion to ADR-015. It is **not** intended to ship to production — see ADR-014 for the production tradeoffs that this prototype deliberately steps around.

## Why this exists

`examples/agents/livekit-agent` bakes its prompt into the worker image (production model — ADR-014). That gives you reproducibility but a slow inner loop:

```
edit prompt → rebuild image → deploy worker → dispatch → talk
```

This POC swaps the image step for a single HTTP call:

```
edit prompt → compile in dashboard → click Talk → fetch prompt → talk
```

Round-trip time from "Save Configuration" to "I can hear the new prompt": ~5 seconds.

## Architecture

```
Dashboard click "Talk to agent"
  ↓
ModelGuide API
  ├─ creates voice-test session
  ├─ dispatches THIS worker (metadata: { agentName: <slug>, session_id, ... })
  └─ returns LiveKit AccessToken
  ↓
Browser joins room via WebRTC
  ↓
THIS worker fires on dispatch
  ├─ GET /api/agents/me   (Authorization: Bearer mgk_...)
  │   → { id, name, slug, compiledInstructions, ... }
  ├─ resolve_instructions(profile, fallback)
  └─ AgentSession(stt, llm[instructions=...], tts, vad)
  ↓
LLM responds using the latest compiled prompt
```

The dispatch metadata contract is unchanged from ADR-014 — the worker never injects a prompt into metadata. The compiled prompt only ever travels server-to-worker over the authenticated `/api/agents/me` channel.

## Stack

| Component | Choice |
|-----------|--------|
| Transport | LiveKit Cloud WebRTC |
| STT | Deepgram Nova-3 |
| LLM | OpenAI `gpt-4.1-mini` |
| TTS | ElevenLabs Flash v2.5 |
| VAD | Silero |
| Turn detection | LiveKit EnglishModel |
| Prompt source | `GET /api/agents/me` (live fetch) |

Tools (MCP) are intentionally omitted. If you want to test tool flows, use `examples/agents/livekit-agent` — that's its job.

## Setup

```bash
# From the repo root
make lk-poc-setup

# Configure secrets
cp examples/agents/livekit-poc-agent/.env.example examples/agents/livekit-poc-agent/.env
# Edit .env with OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY,
# MODELGUIDE_API_KEY (mgk_...), and your LiveKit credentials.
```

The `MODELGUIDE_API_KEY` must belong to the agent you want to test. The worker uses it both to authenticate to ModelGuide and to figure out which agent it represents.

## Run

### Local: WebRTC against a project's LiveKit instance

```bash
make lk-poc-dev
```

The worker registers under `AGENT_NAME=mg-poc-agent` (override in `.env`). Set `metadata.livekit.agentName = "mg-poc-agent"` on the MG agent record so the dashboard dispatches to this worker.

Then:

1. Open the dashboard → Agents → \[your agent\] → Prompt
2. Edit the persona, click **Compile**
3. Scroll to the **Voice Test** card, click **Talk to agent**
4. You're talking to the agent with the prompt you just compiled. Hang up and recompile to test again.

### Production: LiveKit Cloud worker

The POC ships with a Dockerfile mirroring the production agent:

```bash
docker build -t mg-poc-agent examples/agents/livekit-poc-agent
docker run --env-file examples/agents/livekit-poc-agent/.env mg-poc-agent
```

Or push to LiveKit Cloud as a regular agent worker (`lk agent deploy`).

## How it picks the prompt

`src/mg_client.py:resolve_instructions` is the entire decision:

```python
def resolve_instructions(profile, fallback):
    compiled = profile.compiled_instructions
    if compiled and compiled.strip():
        return compiled
    return fallback
```

- If the dashboard operator has compiled a prompt → use it.
- If not → use `FALLBACK_INSTRUCTIONS` from `.env` and greet with `FALLBACK_GREETING`, so the operator hears "no prompt is compiled yet" instead of silence.

That branch is unit-tested at `tests/test_mg_client.py::TestResolveInstructions`.

## Tests

```bash
make lk-poc-test
```

Coverage:

- `AgentProfile.from_api` — parses the `/api/agents/me` JSON contract.
- `resolve_instructions` — compiled-vs-fallback decision.
- `fetch_agent_profile` — HTTP error taxonomy (200, 401, 5xx, transport, non-JSON).

The Python tests pair with `modelguide-api/tests/unit/agents/agent-me-shape.test.ts`, which locks the API response contract. Together they guarantee a field rename on either side is caught before runtime.

## Operational notes

- **Single-tenant per worker.** One `MODELGUIDE_API_KEY` represents one agent. To prototype multiple agents in parallel, run multiple workers with different keys + `AGENT_NAME`s.
- **No transcript posting.** This prototype focuses purely on the prompt loop; messages aren't synced back to ModelGuide. Use the production agent if you need transcripts in `/sessions`.
- **Crashes loud on profile fetch failure.** If `/api/agents/me` is unreachable or the key is invalid, the worker raises and the dispatch fails — better than serving a stub prompt silently.

## See also

- ADR-014 — production voice-test dispatch (no prompt injection)
- ADR-015 — this prototype's runtime-prompt-fetch decision
- `examples/agents/livekit-agent` — the production reference, BuildPro Sam demo with MCP tools and SIP support
