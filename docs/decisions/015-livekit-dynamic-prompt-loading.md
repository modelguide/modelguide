# ADR-015: LiveKit Worker Fetches Compiled Prompt at Session Start

**Status:** Accepted

## Context

ADR-014 shipped the "Talk to agent" voice-test flow but deliberately left
the prompt out of dispatch metadata. The reasoning was sound: putting a
prompt into the dispatch payload creates "works in voice-test, broke in
prod" drift, plus the dispatch metadata is byte-bounded.

That left a real gap. From the operator's perspective:

1. Edit the SOP / persona in the dashboard.
2. Hit **Compile**. A fresh `compiledInstructions` lands in the DB.
3. Hit **Talk to agent**. The browser joins a room with the dispatched
   worker.
4. The worker speaks using the prompt that was **baked into its container
   image** the last time the worker was deployed. The compile in step 2
   is invisible to the call.

The closed feedback loop the operator expected — edit, compile, talk,
hear the change — never happened. The only way to actually exercise a
new prompt against the live worker was to build a new image, redeploy,
and re-dispatch. That's a 5+ minute cycle for what is supposed to be a
< 30 second iteration.

We need a way to test the latest compiled prompt from the dashboard
without redeploying the worker, **without** reintroducing the failure
modes ADR-014 rejected.

## Decision

Add a new endpoint, `GET /api/agents/me/runtime-config`, and have the
LiveKit worker call it once at the top of each session entrypoint.
"Sync" in the operator's mental model maps to the existing Compile
action: compiling persists `compiledInstructions`; the very next
"Talk to agent" click dispatches a fresh worker; that worker fetches
and uses the fresh prompt.

### The endpoint

| Property        | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Method + path   | `GET /api/agents/me/runtime-config`                                    |
| Auth            | Agent API key (`mgk_*`) via `requireAgent()` — user JWT is rejected   |
| Agent identity  | Taken from the auth context — no path param to spoof                  |
| Response shape  | `{ id, name, slug, modality, compiledInstructions, compiledAt, promptConfig }` |
| Errors          | 401 (no/invalid key), 404 (agent deleted between key issue and fetch)  |

The response is deliberately narrow. It excludes the secrets ref map,
the full `metadata` blob (LiveKit URLs, ElevenLabs config, legacy
`webhook_hmac_secret`), and the `organizationId`. A worker that logs its
runtime config — for debugging — cannot accidentally leak sensitive
material. The shape is locked by two unit tests
(`tests/unit/agents/runtime-config.test.ts`) and an integration test that
exercises both the happy path and the auth boundary
(`tests/integration/agents.test.ts` → `GET /api/agents/me/runtime-config`).

### The worker side

The POC agent (`examples/agents/modelguide-livekit-poc-agent`) calls
`fetch_runtime_config()` in parallel with `ctx.wait_for_participant()`,
so the round-trip is hidden under the LiveKit connect/dispatch handshake
that's already in flight. There is no baked-in system prompt; if the
fetch returns `compiledInstructions: null` (operator hasn't compiled
yet), the worker greets with a "your compiled prompt isn't loaded —
hit Compile and try again" fallback so the call connects and the
operator hears something actionable rather than dead air.

Existing workers (`examples/agents/livekit-agent` / BuildPro Sam) are
unaffected — they continue to use their baked-in prompt + MCP tools.
The POC is a separate scaffold, not a migration of the existing agent.

### Why this is NOT what ADR-014 rejected

ADR-014's rejected pattern was **injecting a prompt into dispatch
metadata** as a one-shot override. The concerns were:

1. *Voice-test/prod drift.* The injected prompt only existed in the
   metadata of the voice-test dispatch. The worker's "real" prompt was
   different — what you tested wasn't what production ran.
2. *Byte budgets.* Dispatch metadata has a 48 KB cap; bounded prompts
   required ~100 LOC of size guards.
3. *Authority lives in the wrong place.* The worker's profile is what
   prod actually runs against; metadata-injected prompts were a
   second source of truth that could disagree.

The new pattern inverts that:

- **The dashboard's `compiledInstructions` IS the authoritative prompt.**
  Production traffic and voice-test traffic both consume the same value.
  There is no second source of truth.
- **The prompt never crosses the dispatch boundary.** It's pulled by
  the worker over an authenticated HTTPS call, scoped by the worker's
  own API key. No byte caps on metadata.
- **There is no "voice-test override."** What the operator tests is what
  every other caller of that worker sees, by construction.

The trade-off this introduces — and ADR-014 didn't have to wrestle
with — is that this pattern only works for workers built to fetch
their prompt at runtime. The existing baked-prompt workers are unaffected
and don't need to change.

## Alternatives Considered

**Push the prompt to the worker via a "deploy" call from the dashboard.**
Rejected. Would require a control channel from the API back to the
worker (or to LiveKit Cloud as an intermediary), adding state that has
to be kept in sync. Pulling from a stateless endpoint is simpler and
already happens during the dispatch handshake window.

**Cache the prompt in the worker for N seconds across sessions.**
Rejected for the POC. Adds a "wait, did the cache invalidate?" failure
mode that breaks the "compile, talk, hear the change" promise. The
fetch is one HTTPS call to the same network as MCP; it doesn't merit
caching at this scale.

**Embed the prompt in dispatch metadata with a size guard.**
Rejected — exactly the pattern ADR-014 ruled out, and the operator
ergonomics aren't materially better than a fetch.

**Reuse `GET /api/agents/:id`.**
Rejected. That endpoint is JWT-gated and leaks the secrets ref map,
the full `metadata` blob, and the `organizationId`. Loosening it to
accept agent API keys would widen the dashboard surface to worker
identity, the opposite of what we want.

## Consequences

- **The "edit, compile, talk" iteration is now real.** From compile to
  hearing the new prompt is one click + the LiveKit dispatch handshake
  (~2s end-to-end), no redeploy.
- **The worker becomes thinner.** With the prompt sourced from the
  dashboard, building a new voice-agent persona becomes a dashboard
  config exercise, not a code change + deploy.
- **There's a new API surface to defend.** `/agents/me/runtime-config`
  is agent-authenticated and returns prompt material. If we ever add
  fields here (knowledge-base snippets, evaluator hints), they're
  visible to the worker's API key — keep that in mind when picking
  what to include.
- **Existing baked-prompt workers are unaffected.** ADR-014's voice-test
  flow continues to work as documented; this ADR adds a parallel path
  for workers that opt into the fetch pattern.

## Known limitations (this is a POC)

- **No prompt cache, no etag.** Every session boot does a full fetch.
  Fine at single-digit RPS; would want an etag + a few-second TTL at
  10+ RPS to spare the DB.
- **No fallback to a baked prompt.** If the MG API is unreachable at
  session boot, the call fails. Production workers should layer a
  baked-in last-known-good prompt under the fetch so an MG outage
  doesn't black-hole voice traffic.
- **No tool catalog in the runtime config.** This POC has no tools at
  all. A future iteration will need to return enabled connector tools
  in the same response so the worker doesn't have to wire that up
  per-deploy.

## Related

- **ADR-014:** Browser Voice Testing via LiveKit Dispatch — the
  "no prompt in metadata" decision this ADR works around (not
  contradicts) via a fetch instead of an injection.
- **ADR-011:** LiveKit Outbound Calls — the dispatch + token pattern
  both this and ADR-014 extend.
- **PR:** initial POC implementation — adds the endpoint, the POC
  agent, the voice-test UI affordance, the ADR, and the tests.
