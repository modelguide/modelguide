# ADR-015: LiveKit Workers Fetch Their Prompt at Runtime

**Status:** Accepted

## Context

ADR-014 added the *Talk to agent* button so a dashboard user can click and
start a WebRTC call against the deployed LiveKit worker. That covered the
transport. It deliberately punted on the prompt: the API dispatches a
worker into a room and the worker brings whatever prompt was baked into
its image. The `createVoiceTestSession` doc string is explicit about it —
*"prompt + tools baked into the worker image — we do NOT inject a prompt
from here."*

This left a UX gap. The dashboard exposes a *Compile* button on every
agent (see `prompt-section.tsx` and the `compileAgent` service that
persists `agents.compiled_instructions`). After clicking Compile, the
operator's mental model is "the agent now uses my new prompt." Today that
is only true for ElevenLabs agents (whose `syncAgentToElevenLabs` pushes
the compiled prompt to the platform via the ElevenLabs API). For LiveKit
agents, *Compile* updates a database column nobody downstream reads, and
the next *Talk to agent* call still uses the prompt baked into the worker
image at last deploy.

The fix needs to:

1. Be invisible to the operator — no extra "Sync to LiveKit" button.
2. Avoid coupling the dashboard to LiveKit Cloud (no need for the API
   server to call into the worker).
3. Survive worker redeploys — the source of truth is ModelGuide, not
   any one worker container.
4. Degrade gracefully when ModelGuide is unreachable — the call must still
   complete with audio, even if it's the old prompt.

## Decision

The worker fetches its prompt from ModelGuide on every session start.

### New endpoint: `GET /api/agents/me/runtime-config`

Authenticated by the worker's own agent API key (`mgk_*`). Returns the
narrow set of fields a worker actually needs:

```json
{
  "id": "uuid",
  "name": "...",
  "slug": "...",
  "modality": "voice",
  "agentPlatform": "livekit",
  "modelFamily": "gpt",
  "isActive": true,
  "compiledInstructions": "...",
  "compiledAt": "2026-04-01T00:00:00.000Z",
  "promptConfig": { ... },
  "metadata": { ... }
}
```

Three things to note:

- **API-key-only.** User JWTs are rejected. The endpoint is for workers,
  not the dashboard — the dashboard's `GET /agents/{id}` is unchanged.
- **No secrets, no integration URLs, no eval state.** Each new field is
  a deliberate decision; the unit test
  (`tests/unit/agents/runtime-config.test.ts`) explicitly asserts the
  shape so a refactor that swaps in `formatAgent` doesn't widen the
  payload by accident.
- **`me`, not `{id}`.** The agent identity is derived from the API key,
  so the worker doesn't need to know its own UUID. The route is registered
  before `/:id` to avoid being parsed as a UUID.

### Worker-side contract

`examples/agents/livekit-poc-agent/src/livekit_poc_agent/runtime_config.py`
exposes:

- `fetch(base_url, api_key)` → typed `RuntimeConfig` dataclass
- `resolve_instructions(config, fallback)` → str

The worker's entrypoint resolves instructions like this:

```python
rt = await runtime_config.fetch(base_url=…, api_key=…)
instructions = runtime_config.resolve_instructions(rt, fallback=BAKED_IN)
agent = Agent(instructions=instructions)
```

`resolve_instructions` returns `compiled_instructions` if present (and
non-blank), otherwise the baked-in fallback. Empty / whitespace-only is
treated as 'not compiled' so a half-saved compile doesn't strand the
worker with a useless prompt.

### Failure handling

- **HTTP error during fetch** — log, fall through to the baked-in
  fallback. The call completes; the operator hears a generic greeting.
- **Agent never compiled** — fall back. Same outcome.
- **ModelGuide entirely down** — fall back. Same outcome.

In all three cases the LiveKit call still connects and the operator gets
audio. We deliberately do not block the room on a successful fetch.

## Consequences

### Positive

- **Compile in dashboard → talk to the new prompt** works for LiveKit
  agents the same way it works for ElevenLabs agents (just by a different
  mechanism — pull vs. push).
- **No worker-image rebuild** for prompt iteration. The image only needs
  to change when the *worker code* changes.
- **The contract is testable.** Both sides have unit tests that fail if
  the shape drifts (`tests/unit/agents/runtime-config.test.ts` on the
  API; `tests/test_runtime_config.py` on the worker). The integration
  test (`tests/integration/agent-runtime-config.test.ts`) covers the
  HTTP-level auth.

### Negative / trade-offs

- **One extra round-trip per session start.** It runs in parallel with
  participant connection so it doesn't add to time-to-first-audio
  unless the API is slow.
- **The prompt is cached for the lifetime of the call.** A re-compile
  mid-call is not picked up. Polling or push (LiveKit data channels)
  would solve it; deferred until there's a real use case.
- **Fallback drift.** A worker can quietly serve the baked-in fallback
  forever if ModelGuide is unreachable on every call. Mitigated by the
  warning log in `agent.py` and operator-visible session metadata in the
  dashboard.

### Alternatives rejected

- **Push prompt at dispatch time** (e.g. include `compiledInstructions`
  in the dispatch metadata blob). Rejected: metadata blobs are length-
  limited in some LiveKit SDK versions, and it couples the dashboard to
  knowing every worker's prompt format.
- **Reuse `GET /agents/{id}`** with API key auth. Rejected: that endpoint
  carries secrets, integration URLs, eval state — none of which a worker
  needs and all of which become a future leak surface.
- **Compile on every voice-test click** (so the database is always
  fresh). Rejected: compilation is expensive and the operator may want
  to test a half-edited prompt — let *Compile* be the explicit step.

## References

- POC implementation: `examples/agents/livekit-poc-agent/`
- API: `src/features/agents/agents.service.ts` (`formatRuntimeConfig`,
  `getAgentRuntimeConfig`) and `agents.routes.ts`
  (`/me/runtime-config` route)
- Tests:
  - `modelguide-api/tests/unit/agents/runtime-config.test.ts`
  - `modelguide-api/tests/integration/agent-runtime-config.test.ts`
  - `examples/agents/livekit-poc-agent/tests/test_runtime_config.py`
- Related: ADR-011 (LiveKit outbound calls), ADR-014 (browser voice
  testing — the transport this builds on).
