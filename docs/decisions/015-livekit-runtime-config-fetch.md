# ADR-015: LiveKit Prototype — Pull Compiled Prompt at Session Start

**Status:** Proposed (POC; see `examples/agents/livekit-prototype/`)

## Context

The existing LiveKit voice-test flow (ADR-014) dispatches a worker whose
prompt is baked into its container image. Iterating on the prompt requires
a redeploy — a slow loop that doesn't fit the dashboard-driven UX we want.

Meanwhile the ElevenLabs path already supports a "Sync" button (see
`agents.sync.ts`) that PUSHes the compiled prompt + MCP server config to
ElevenLabs at the dashboard's request. ElevenLabs is the authoritative
runtime; ModelGuide writes to it.

For LiveKit we wanted the same one-click "edit → sync → talk" experience
without porting the entire ElevenLabs push pipeline. A second look at the
problem made it cleaner to **invert** the direction of data flow: instead of
ModelGuide pushing to the worker, the worker pulls from ModelGuide at session
start.

Inspired by [voiceblox](https://github.com/voiceblox-ai/voiceblox), which
demonstrates this "thin worker, remote prompt" pattern for LiveKit.

## Decision

Add `GET /api/agents/me/runtime-config` to the ModelGuide API. A deployed
LiveKit worker calls it on every dispatched room using its own agent API
key, and the response carries the latest compiled prompt:

```json
{
  "agentId": "...",
  "slug": "support-voice",
  "name": "Support Voice",
  "modality": "voice",
  "modelFamily": "gpt",
  "compiledInstructions": "You are a helpful, friendly assistant.",
  "compiledAt": "2026-03-01T10:00:00.000Z"
}
```

Auth is the agent's own API key (`mgk_…`) via the existing `requireAgent()`
middleware. The path is `/me` rather than `/:id` because the key already
identifies the agent — mirrors `/users/me`. The full route definition lives
in `agents.routes.ts`; the response builder is the pure function
`buildRuntimeConfig` in `agents.service.ts`, locked behind a unit test
contract (`tests/unit/agents/runtime-config.test.ts`).

The prototype worker (`examples/agents/livekit-prototype/`) is a single
Python file that:

1. Validates env on entrypoint.
2. `await mg_client.fetch_runtime_config()` in parallel with session
   creation.
3. Builds `Agent(instructions=cfg.resolve_instructions())`.
4. Starts the AgentSession.

`resolve_instructions()` returns the compiled prompt if present, otherwise
a baked-in `FALLBACK_PROMPT`. That fallback guards against an
uncompiled-but-active agent rendering as silence to a caller — explicit
"give the operator a moment" beats an unmoored LLM.

### What this means for the "Sync & Test" UI

The dashboard's "Talk to agent" button doesn't change. It still dispatches
the worker the same way `voice-test-token` always has. What changes is what
the worker does on the OTHER end: it fetches `runtime-config` instead of
reading a baked-in prompt file.

So "Sync" disappears as a separate concept for LiveKit. The act of compiling
the prompt IS the sync — the worker will pick it up on the next call. The
UI just surfaces the compiled-at timestamp so the operator sees which prompt
they're talking to.

## Tension with ADR-014

ADR-014 explicitly rejected putting the prompt in dispatch metadata:

> The worker's profile is the authoritative source of prompt + tools.
> Injecting a different prompt creates a "it works in voice-test but
> broke in prod" failure mode.

That decision stands for **multi-profile workers that bake their prompts
into the image**. This ADR introduces a different worker shape:

| Worker shape | Authoritative source | Pattern |
|---|---|---|
| Multi-profile baked (ADR-014) | Worker image | Push config to platform at deploy |
| Thin pull (this ADR, prototype) | ModelGuide compiled prompt | Worker fetches at session start |

Both can coexist. The thin-pull worker is opt-in by deploying the prototype
image; the baked workers (e.g. BuildPro Sam) keep working unchanged. The
voice-test endpoint doesn't need to know which kind of worker it's
dispatching — it just hands off `agentName + agentSlug` like it always did.

The "voice-test vs prod" drift concern doesn't apply to thin-pull workers
because there IS no "test prompt" vs "prod prompt" — the worker only ever
serves whatever ModelGuide last compiled.

## Alternatives Considered

**Push the prompt to the worker on click (HTTP RPC).** Rejected — requires
the API to know the worker's address, opening firewall holes and coupling
deploy topology to the API. Pull keeps the worker behind whatever NAT it
wants.

**Embed the prompt in dispatch metadata.** Rejected (echoing ADR-014 for the
baked-worker case + size limits — LiveKit dispatch metadata is capped). The
GET-endpoint payload is JSON we control; no platform-specific byte budget.

**Side-channel via Redis / Kafka.** Rejected for a POC — introduces a new
runtime dependency. Worth revisiting only if "wait for the next dispatch
to pick up the new prompt" becomes a real friction (it isn't yet, since
operators always click "Talk to agent" after editing).

**Worker subscribes to a long-poll / SSE stream.** Rejected — overkill. The
prompt is fetched once per session, not continuously.

**Return the full agent record (`GET /agents/me`).** Rejected — the agent
detail shape is shaped for the dashboard (eval suite counts, integration
URLs, secrets refs). A worker doesn't want any of that. A purpose-built
endpoint can grow only the fields a worker actually consumes.

## Consequences

### Good

- Operator edits prompt → clicks Compile → clicks Talk → hears the new
  prompt. Round trip is ~2s (token + dispatch + fetch + WebRTC). No
  redeploy.
- The API becomes the single source of truth for the prototype's prompt.
  No drift between "the prompt I see in the dashboard" and "the prompt
  the worker is using".
- Per-org isolation comes free: the agent's API key auth is RLS-scoped
  via the existing `requireAgent()` middleware. A worker can never read
  another org's prompt.

### Bad / risk

- **Latency floor adds one round-trip** to ModelGuide on every session
  start. We mitigate by doing it in parallel with `create_session` (both
  are independent network calls); typical wall time is ~50ms on the
  local API. If this becomes the hot path for a high-fan-out worker,
  cache the response for ~1s.
- **API uptime becomes a runtime dependency.** A ModelGuide outage takes
  down voice agents. The mitigation in code is the `FALLBACK_PROMPT`
  only kicks in for null-but-200 responses; non-2xx still crash-loops on
  purpose because that's almost certainly an auth or deploy mistake we
  want surfaced. A future hardening (out of scope for the POC) would
  cache the last-successful response on the worker so a transient API
  blip doesn't abort active calls.
- **No prompt versioning yet.** A worker session always picks up the
  CURRENT compiled prompt — there's no way for a caller mid-session to
  benefit from a hot-edit, and there's no way to "talk to v1 while
  reviewing v2". Both are fine for the POC; an `?version=` query
  parameter would be the natural extension.
- **Two worker shapes now coexist** (baked + thin-pull). Future
  documentation needs to make the choice explicit on the LiveKit
  configuration screen ("Is this a thin-pull worker?") rather than
  silently dispatching either way.

## Known test gap

The "fetch happens before the LLM is constructed" ordering in
`entrypoint()` isn't itself covered — testing it would require booting a
LiveKit server in CI. The pieces are covered individually:

- `buildRuntimeConfig` shape (Bun unit test).
- `/me/runtime-config` happy path, 401 path, and uncompiled-200 path
  (Bun integration test — runs against a Postgres testcontainer).
- `fetch_runtime_config` / `resolve_instructions` over a `MockTransport`
  (Python pytest in the prototype).

If the entrypoint orchestration drifts (e.g. someone moves the fetch after
`Agent(...)`), CI doesn't catch it. Same gap as ADR-014's known test gap
section — both share the "real LiveKit server in CI is out of scope"
constraint.

## Related

- ADR-014: Browser Voice Testing via LiveKit Dispatch — the dispatch +
  token flow this builds on. Rejected metadata-prompt-injection; this
  ADR takes a different shape (pull from worker) that doesn't fall into
  that rejection's reasoning.
- ADR-011: LiveKit Outbound Calls — same dispatch primitive, different
  metadata payload.
- `examples/agents/livekit-prototype/` — the worker.
- `examples/agents/livekit-agent/` — the production-grade baked worker
  (BuildPro Sam); unchanged.
