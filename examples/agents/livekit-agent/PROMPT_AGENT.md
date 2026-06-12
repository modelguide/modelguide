# Voice Prototype — Prompt-Driven LiveKit Agent

A LiveKit worker that takes the **agent's latest compiled prompt** off the
dispatch metadata and runs an `AgentSession` with that prompt verbatim.
Sibling to `BuildProAgent`/`agent.py`, not a replacement.

## Why a separate entrypoint?

The production "Talk to agent" panel (`POST /agents/:id/voice-test-token`,
ADR-014) dispatches a worker whose **profile owns the prompt** — slug-to-
profile routing on the worker, prompt baked into Python at deploy time.
That keeps the voice-test path in lockstep with what gets paged in production.

The prototype path, on the other hand, is the loop an admin uses while
iterating on a prompt:

```
edit SOP → recompile prompt → click "Talk to prototype" → hear it
```

Redeploying a worker profile in the middle of that loop would kill it. So
the prototype ships the compiled prompt **in dispatch metadata** and the
worker uses it directly. See `docs/decisions/015-livekit-prompt-driven-voice-prototype.md`
for the trade-off (and what we deliberately gave up — tool calling, SIP,
and the prompt-pinning guarantee of ADR-014).

## How it differs from `BuildProAgent`

| Aspect | `BuildProAgent` (production) | `PromptAgent` (prototype) |
|---|---|---|
| Entrypoint | `src/agent.py` | `src/prompt_entry.py` |
| Worker `agent_name` | `buildpro-sam` (slug-routed) | `voice-prototype` |
| System prompt | Built from `prompts/base.py` + workflows | `dispatch_metadata.compiled_prompt` |
| Tools | 11 `@function_tool` methods → MCP | None (chat-only — by design) |
| SIP / outbound | Yes | No |
| Stubbed tools | Yes | N/A |
| Transcript posted to MG | Yes | Yes |
| Langfuse tracing | Yes (opt-in) | Future work |

## Local development

```bash
# From the repo root
make lk-agent-setup       # if not already done
cd examples/agents/livekit-agent
cp .env.example .env
# fill in OPENAI_API_KEY, DEEPGRAM_API_KEY, MODELGUIDE_*, etc.

source .venv/bin/activate
python src/prompt_entry.py dev
```

Then from the dashboard, on a LiveKit agent that has a compiled prompt,
click **Talk to prototype**.

> Console mode (`python src/prompt_entry.py console`) is useful for trying
> the entrypoint without LiveKit/WebRTC, but it bypasses dispatch metadata
> — so it always says "the prompt is empty". To exercise the dispatch path,
> use `dev` and click through from the dashboard.

## Dispatch metadata contract

The API (`createVoicePrototypeSession` in
`modelguide-api/src/features/agents/agents.service.ts`) JSON-encodes:

```jsonc
{
  "mode": "voice-prototype",          // entrypoint refuses anything else
  "agentName": "your-agent-slug",     // mirrors agent.slug (same as voice-test)
  "agent_id": "uuid",                 // for transcript + Langfuse correlation
  "session_id": "uuid",               // ModelGuide session row created up-front
  "user_identifier": "caller@x",      // becomes the session's userIdentifier
  "email": "caller@x",                // duplicate for legacy worker compat
  "compiled_prompt": "..."            // verbatim system prompt, no trim/transform
}
```

Both ends of this contract are covered by tests:

- API side: `modelguide-api/tests/unit/agents/voice-prototype-dispatch.test.ts`
- Worker side: `examples/agents/livekit-agent/tests/test_prompt_agent.py::TestParseDispatchMetadata`

If you change the shape, both tests must move together.

## Tests

Worker:

```bash
cd examples/agents/livekit-agent
source .venv/bin/activate
pytest tests/test_prompt_agent.py -v
```

API:

```bash
cd modelguide-api
bun test --preload ./tests/setup/unit-preload.ts tests/unit/agents/voice-prototype-dispatch.test.ts
```

UI:

```bash
cd modelguide-ui
bun run test src/features/agents/components/voice-prototype-panel.test.tsx
```

## Deploying alongside the production worker

You can run both workers from the same image — they just register different
`agent_name`s with LiveKit. Two `python` processes, two `WorkerOptions`:

```dockerfile
# Production "Talk to agent"
CMD ["python", "src/agent.py", "start"]
```

```dockerfile
# Prototype "Talk to prototype" (separate Railway service)
CMD ["python", "src/prompt_entry.py", "start"]
```

LiveKit dispatches by `agent_name`, so the API picks the right worker for
each panel and the two stay out of each other's way.
