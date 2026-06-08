# ADR-015: Runtime Prompt Fetch for LiveKit Voice Agents

**Status:** Accepted

## Context

The dashboard already lets admins:

1. Edit `promptConfig` (persona / language / filler phrases)
2. Compile a prompt from one or more assigned SOPs → `agents.compiledInstructions`
3. Click **Talk to agent** in the voice-test panel (ADR-014) to dispatch the
   deployed LiveKit worker and join the room from the browser

The gap: step 3 reaches a worker whose system prompt is **baked into the worker
image** (e.g. `examples/agents/livekit-agent/src/prompts/`). When step 2 produces
a new compiled prompt, the next "Talk to agent" call still uses the **old**
prompt — admins have to redeploy the worker to see the change. That kills the
compile-and-talk feedback loop the platform was built around.

The closely related ADR-014 specifically rejected solving this by having the
**client** inject the prompt into LiveKit dispatch metadata. That rejection
stands: it would let any caller smuggle arbitrary instructions into a
voice-test, and force the client to know byte limits / encoding rules / the
worker's profile structure.

This ADR addresses the same gap from the other side: have the **worker**
authoritatively pull the latest compiled prompt from ModelGuide at session
start. ModelGuide remains the canonical source — the client never names a
prompt, never sends bytes the worker has to bound-check.

## Decision

Add an agent-authenticated `GET /api/agents/me/runtime-config` endpoint and a
`INSTRUCTIONS_SOURCE=local|remote` switch on the LiveKit worker. When set to
`remote`, the worker fetches the latest `compiledInstructions` on each session
start and uses it as the system prompt (after the usual `{{mg_session_id}}` /
`{{userEmail}}` interpolation). Failure to fetch falls back to the baked-in
prompt — the worker is never blocked.

### Endpoint shape

`GET /api/agents/me/runtime-config` — auth: `requireAgent()` (API key only,
`mgk_*`).

```ts
{
  id: string,           // agent uuid
  name: string,
  slug: string,
  modality: "voice" | "text",
  modelFamily: "gpt" | "claude" | "gemini" | "generic",
  promptConfig: { persona?, language?, fillerPhrases? } | {},
  compiledInstructions: string | null,   // latest compiled prompt
  compiledAt: string | null,             // ISO timestamp
  isActive: boolean,
}
```

Deliberately narrower than `GET /api/agents/:id`: no secrets map, no
integration URLs, no metadata, no eval counts. The worker doesn't need those
to bootstrap a session, and shipping them would leak more org-internal state
than necessary into the runtime envelope.

The worker authenticates with its own API key (the one minted at agent
creation), so the endpoint trivially scopes to the calling agent — no `:id`
in the path means there's no enumeration surface and no cross-org footgun.

### Worker side

`examples/agents/livekit-agent/src/agent.py` gains a `_resolve_instructions_override()`
helper called once per session, after session creation, before the agent is
constructed:

```python
async def _resolve_instructions_override() -> str | None:
    if config.INSTRUCTIONS_SOURCE != "remote":
        return None
    cfg = await mg_client.get_runtime_config()
    if not cfg or not cfg.get("compiledInstructions"):
        return None
    return cfg["compiledInstructions"]
```

`BuildProAgent.__init__(..., instructions_override=...)` threads the value
into `build_system_prompt(template=...)`, which keeps placeholder
interpolation working identically whether the prompt is baked-in or
freshly compiled.

### Failure modes

The fetch is best-effort. Every failure path falls back to the baked-in
template — never to a half-loaded prompt:

| Condition | Behavior |
|---|---|
| `INSTRUCTIONS_SOURCE=local` (default) | Skip fetch entirely. No network call. |
| Network error / timeout | Log a warning, use baked-in. |
| 4xx / 5xx from API | Log a warning, use baked-in. |
| `compiledInstructions: null` (no compile yet) | Use baked-in. |
| `compiledInstructions: ""` (explicitly empty) | Use baked-in. An empty prompt is never useful. |
| Valid compiled prompt | Use it as the system prompt. |

`local` stays the default to keep first-time setup and the "I just want to
try the example" path zero-config. New customer agents flip to `remote` once
they've compiled at least one prompt from the dashboard.

## What this is NOT

- **Not a prompt-override channel from the client.** The client never names
  a prompt; the worker authenticates as itself and asks MG. ADR-014's
  rejection of client-side injection still stands.
- **Not a hot-reload during a live call.** Fetch happens once per session
  start, before LLM context is built. Changing the compiled prompt mid-call
  doesn't reach an in-progress session — by design (mid-call prompt swaps
  produce chaotic LLM behavior).
- **Not a replacement for redeploying tool wiring.** Tool registration
  (`@function_tool` methods, MCP name mapping, guardrails) is still baked
  into the worker image. The runtime fetch only swaps the system-prompt
  *string*. Adding a new tool still needs a worker release.
- **Not coupled to the voice-test endpoint.** Every dispatch — voice-test,
  outbound call (ADR-011), or production inbound — uses the same resolver.
  The dashboard "Talk to agent" button just becomes a faster feedback loop
  on top of the same path.

## Alternatives Considered

**Hot-reload the prompt during a live session.** Rejected — LLMs respond
poorly to mid-conversation system-prompt rewrites (lost context, contradiction
with prior turns). Swap at session start only.

**Worker subscribes to a "prompt updated" webhook from MG.** Considered;
rejected for the prototype. A pull-at-session-start model has zero new
infrastructure (no webhook secrets, no retry queue, no worker-side HTTP
listener). If real-time invalidation ever becomes necessary, this ADR's
pull path stays compatible.

**Embed `compiledInstructions` in `dispatch_metadata` (the rejected
ADR-014 design).** Still rejected for the same reasons: drift between
"what the client sent" and "what the agent profile actually does" + byte
caps to enforce.

**Expand `GET /api/agents/:id` to accept agent-key auth.** Rejected —
that endpoint returns secrets refs, external IDs, eval counts, and other
admin-shaped fields. Loosening its auth would either leak admin data to
workers or require a fork of the response shape. A dedicated runtime
endpoint with a narrower payload is cleaner.

## Consequences

- The compile → talk loop is **one click** when `INSTRUCTIONS_SOURCE=remote`:
  edit prompt config → Compile → Talk to agent → new prompt is live in the
  next call.
- Per-session latency cost: one extra HTTPS GET to MG at connection setup.
  Measured at ~80–150 ms in `make api-dev` against localhost; negligible
  against LiveKit's own connection setup.
- Failure of the MG API does not break voice calls — the worker uses its
  baked-in fallback. Operationally this means a dashboard outage degrades
  to "old prompt" rather than "no calls work."
- The baked-in prompt now serves as the **safety net**, not the source of
  truth, when `remote` is enabled. Keeping the baked-in copy reasonably
  fresh is still a good practice (it's what gets used during MG outages).
- Drift watch: `mg_client.get_runtime_config()` swallows errors and returns
  `None`. If MG ever changes the response shape (e.g. moves
  `compiledInstructions` under a `prompt: { … }` envelope), the worker
  silently falls back to baked-in instead of crashing. This is the right
  trade-off for runtime stability — but means a schema change without a
  worker bump produces "compiled prompt isn't taking effect anymore" rather
  than a loud error. Mitigation: the integration test
  (`agents.test.ts` → `GET /api/agents/me/runtime-config`) asserts the
  exact field name, so a server-side rename has to update the test, which
  is the prompt to also bump the worker.

## Related

- ADR-011: LiveKit Outbound Calls — the dispatch pattern this builds on.
- ADR-014: Browser Voice Testing — the "Talk to agent" flow this completes.
- `examples/agents/livekit-agent/README.md` — worker-side usage.
- PR introducing this ADR adds: API endpoint, Python client + tests, agent
  resolver + tests, UI hint in the voice-test panel.
