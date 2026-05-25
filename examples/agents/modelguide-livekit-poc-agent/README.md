# ModelGuide LiveKit POC Agent

A minimal LiveKit voice agent whose **entire system prompt comes from the
ModelGuide dashboard**. There is no baked-in prompt in this image — on every
session, the agent calls `GET /api/agents/me/runtime-config` and uses the
agent's latest compiled prompt as its instructions.

This closes the dashboard ⇄ deployed-agent loop:

```
┌──────────────────┐    Compile     ┌────────────────────┐
│ ModelGuide UI    │  ───────────▶  │ agent.compiledInstr│
│ (prompt editor)  │                │ (DB, authoritative)│
└──────────────────┘                └─────────┬──────────┘
                                              │ fetch on boot
                                              ▼
                                    ┌────────────────────┐
                                    │ LiveKit POC worker │
                                    │ (this package)     │
                                    └─────────┬──────────┘
                                              │ WebRTC
                                              ▼
                                       Operator's browser
                                       ("Talk to agent")
```

**What "Sync" means here:** Hitting Compile in the dashboard persists a new
`compiledInstructions` on the agent row. The next "Talk to agent" click in
the voice-test panel dispatches this worker; the worker fetches the row;
the call uses the freshest prompt. No redeploy, no dispatch-metadata round-trip.

See **[ADR-015](../../../docs/decisions/015-livekit-dynamic-prompt-loading.md)**
for the design rationale (and why this approach does not contradict
[ADR-014](../../../docs/decisions/014-browser-voice-testing.md)'s "no prompt
in dispatch metadata" stance).

---

## What this POC deliberately is and isn't

**Is:**
- A reference for the worker-fetches-prompt pattern
- A scaffold you can fork to wire dashboard-driven prompts into any
  LiveKit-based voice agent
- Deployable to LiveKit Cloud as-is (Dockerfile + `livekit.toml`)

**Isn't:**
- A production agent — no MCP tools, no SOPs, no telephony, no retries
- A replacement for `examples/agents/livekit-agent` (BuildPro Sam), which
  still uses a baked-in prompt and ships an 11-tool MCP integration

## Stack

| Component       | Service                     |
| --------------- | --------------------------- |
| Transport       | LiveKit Cloud WebRTC        |
| VAD             | Silero                      |
| Turn detection  | English EOU model           |
| STT             | Deepgram Nova-3             |
| LLM             | OpenAI GPT-4.1-mini         |
| TTS             | ElevenLabs Flash v2.5       |
| Instructions    | **ModelGuide compiled prompt (fetched per session)** |

## Quick start (local)

```bash
# 1. Install deps + download VAD/turn-detector models
cd examples/agents/modelguide-livekit-poc-agent
uv venv && uv pip install --python .venv/bin/python "."
uv run --python .venv/bin/python python src/agent.py download-files

# 2. Configure
cp .env.example .env
# Fill in OPENAI_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY,
# MODELGUIDE_API_URL, MODELGUIDE_API_KEY (the mgk_ key shown at agent
# creation in the dashboard).

# 3. Three terminals:
#    Terminal 1: livekit-server --dev
#    Terminal 2: uv run python src/agent.py dev
#    Terminal 3: from the ModelGuide dashboard → Agent → Voice Test → Talk
```

In the dashboard:

1. Open the agent.
2. **Compile the prompt** from a SOP (Compiled tab → Compile Prompt).
3. Click **Talk to agent** in the Voice Test panel.

The worker will log a line like:

```
mg_client | INFO | Runtime config: agent=… slug=… compiled_at=2026-05-20T12:00:00Z has_prompt=True
```

confirming it fetched the prompt you just compiled.

## Tests

```bash
.venv/bin/python -m pytest tests/ -v
```

Six unit tests covering the `RuntimeConfig` decoder, the compiled/fallback
prompt selection, and the HTTP wiring (Authorization header, 401 handling).
No network required — `respx` intercepts.

## LiveKit Cloud deploy

1. Fill in `livekit.toml` (subdomain).
2. Set `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`,
   `MODELGUIDE_API_URL`, `MODELGUIDE_API_KEY`, and `AGENT_NAME` in the
   LiveKit Cloud secrets UI.
3. `lk agent deploy` from this directory.
4. In ModelGuide: open the agent → LiveKit panel → set the URL and the
   `agentName` to match `AGENT_NAME` → Save.
5. Compile a prompt → Talk to agent.

## Where the magic lives

| File              | Role                                                |
| ----------------- | --------------------------------------------------- |
| `src/agent.py`    | Entrypoint: fetch runtime config in parallel with `wait_for_participant`, then build the `AgentSession` with the compiled instructions. |
| `src/mg_client.py`| HTTP client. `fetch_runtime_config()` + `RuntimeConfig.resolved_instructions()` are the two functions worth reading. |
| `src/config.py`   | Env vars + the "no compiled prompt yet" fallback. |

The whole "use dashboard prompt" loop is ~30 lines, end to end.
