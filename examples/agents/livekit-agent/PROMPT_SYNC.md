# Prompt Sync (ADR-015 Prototype)

A short feedback loop for prompt iteration: edit a prompt in the
ModelGuide dashboard, compile it, click "Talk to agent" with **Use
latest compiled prompt** enabled, and hear the result without
redeploying the worker.

> **Status:** Prototype. The default "Talk to agent" path
> (ADR-014) is unchanged — the worker uses its baked-in profile
> prompt unless the operator opts in.

## How it works

```
Dashboard                                    LiveKit worker
─────────                                    ──────────────
1. Operator edits / compiles a prompt
   → agents.compiledInstructions
   → agents.compiledAt

2. Operator toggles "Use latest compiled prompt"
   on the Voice Test panel and clicks "Talk to agent"

3. POST /agents/:id/voice-test-token
   { "useCompiledPrompt": true }

   API reads compiledInstructions + compiledAt,
   adds them to LiveKit dispatch metadata as
   `compiled_prompt` + `compiled_prompt_compiled_at`,
   then dispatches the worker into a fresh room.
                                            ↓
4. Browser joins room                       Worker entrypoint reads
   via the returned token                   ctx.job.metadata, finds
                                            `compiled_prompt`, and
                                            passes it to BuildProAgent
                                            via `instructions_override=...`.

5. Operator talks to the agent — the LLM's system prompt is the
   string the dashboard just compiled, not the one baked into the
   worker image.
```

When `useCompiledPrompt=false` (or the body is omitted), the worker
takes the existing ADR-014 path and uses its baked-in prompt — the
prompt-sync code is a no-op.

## Wire contract

The dispatcher emits this JSON in `ctx.job.metadata`:

```json
{
  "mode": "voice-test",
  "agentName": "<agent.slug>",
  "session_id": "<uuid>",
  "user_identifier": "<email>",
  "email": "<email>",
  "compiled_prompt": "<string>",
  "compiled_prompt_compiled_at": "<ISO 8601>"
}
```

The last two fields are present only when the operator opted in. The
worker uses `dict.get("compiled_prompt")` so an absent field falls
through to the baked-in path.

The contract is pinned from both ends:

- **Dispatcher side:** `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts`
  — `buildVoiceTestDispatchMetadata` test cases for
  `compiled_prompt` absence and presence.
- **Worker side:** `examples/agents/livekit-agent/tests/test_prompt_sync.py`
  — `BuildProAgent` test cases for the override path and parsing
  the dispatcher's exact JSON shape.

If either side renames the field, both sides keep building and only
the paired tests catch it. Keep them in sync.

## Testing the worker side locally

```bash
# Run just the prompt-sync tests
cd examples/agents/livekit-agent
uv run pytest tests/test_prompt_sync.py -v
```

The tests don't need a LiveKit server, an MCP backend, or any
network. They construct `BuildProAgent` directly with an
`instructions_override` arg and assert that the instructions match.

## End-to-end sanity check (with a local LiveKit server)

```bash
# Terminal 1 — LiveKit server
make livekit-up

# Terminal 2 — voice agent
make lk-agent-dev

# Terminal 3 — fire a token with useCompiledPrompt=true (replace IDs)
curl -X POST "$API_URL/api/agents/<agent-id>/voice-test-token" \
  -H "Authorization: Bearer <dashboard-token>" \
  -H "Content-Type: application/json" \
  -d '{"useCompiledPrompt": true}'
```

The worker log should include:

```
agent | INFO  | Prompt-sync test: using compiled prompt (len=<N>, compiled_at=<ts>)
```

If that line doesn't appear, the dispatch metadata didn't carry the
field — usually because the agent's `compiledInstructions` is
`null`. Compile the agent first.

## What this does NOT do

- It does **not** override tools. The worker's profile still owns the
  tool set and tool execution. Prompt-sync is for prompt iteration
  only.
- It does **not** persist anything new. The same session is created,
  the same transcript is collected, the same analytics row is
  written.
- It does **not** cap the prompt size. Currently relies on operators
  not compiling 40KB+ prompts. A byte cap is a graduation criterion
  before this leaves prototype status (see ADR-015).

## Reverting

The whole prototype is gated by one body field. To revert to pure
ADR-014 behavior platform-wide, hide the toggle on the dashboard —
the API + worker code stay functionally idempotent (an absent
`compiled_prompt` is the existing path).
