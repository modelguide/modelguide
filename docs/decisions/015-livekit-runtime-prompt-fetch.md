# ADR-015: LiveKit Voice Worker Fetches Compiled Prompt at Session Start

**Status:** Accepted

## Context

ADR-014 wired up the dashboard's **Talk to agent** button. The button mints a
LiveKit token, dispatches a worker, and the operator joins via WebRTC. What it
doesn't do is propagate prompt changes: the BuildPro example agent
(`examples/agents/livekit-agent/`) bakes its prompt into Python files at
worker-image-build time, so iterating on the prompt means a redeploy.

ADR-014 explicitly rejected one workaround: **shipping the prompt as a
`prompt_override` field on the dispatch metadata**. The grounds: it creates a
"works in voice-test, breaks in prod" failure mode because the worker's profile
(tools + pipeline + persona) becomes inconsistent with the prompt the operator
just tested.

This ADR proposes the alternative the dashboard team actually wants — change
the prompt in the UI, click Compile, click Talk, and the very next call uses
the freshest compiled prompt without a worker redeploy and without breaking
the property ADR-014 was protecting.

## Decision

Add `GET /api/agents/me`. Authenticated by the agent's API key (`mgk_...`),
so the worker authenticates as the agent record it's serving and gets back:

```jsonc
{
  "id": "...",
  "slug": "...",
  "name": "...",
  "modality": "voice",
  "modelFamily": "gpt",
  "agentPlatform": "livekit",
  "isActive": true,
  "promptConfig": { "persona": "..." },
  "metadata": { "livekit": { "url": "...", "agentName": "..." } },
  "compiledInstructions": "...",     // ← latest compiled prompt
  "compiledAt": "2026-02-01T...",
  "updatedAt": "2026-02-01T..."
}
```

Add a new prototype LiveKit agent (`examples/agents/livekit-prototype-agent/`)
that hits this endpoint at session start and uses `compiledInstructions` as
the system prompt. Fallback chain: compiled prompt → `promptConfig.persona` →
generic identity string. The prototype is single-provider (OpenAI Realtime),
no tools, ~150 LOC — its job is to demonstrate the freshness loop, not to be a
production agent.

### Why pull-at-session-start, not push-via-metadata

| Aspect | Push (rejected by ADR-014) | Pull at session start (this ADR) |
|---|---|---|
| Where the worker reads the prompt | Dispatch metadata blob | REST call to `/api/agents/me` |
| Operator clicks Compile, then Talk → what runs? | The just-compiled prompt (because the API copies it into metadata at dispatch time) | The just-compiled prompt (because the API persisted it before dispatch + the worker reads on connect) |
| Operator clicks Talk twice in a row without recompiling → what runs? | Identical, because metadata is the source of truth | Identical, because `compiledInstructions` hasn't changed |
| Operator edits the prompt directly in the DB → what runs? | Stale (cached on the worker until next dispatch) | Fresh on the next call (worker re-reads every session) |
| Wire size pressure | Prompt-shaped (10–50KB) added to every dispatch metadata blob | Zero — metadata stays small |
| Failure mode if the prompt source is unreachable | Dispatch fails → user sees an error before the room | Worker fetches at connect → can fall back to `persona` or generic; never blocks the call |
| Tools / pipeline / persona stay consistent with the prompt? | No — that's ADR-014's "works in voice-test, breaks in prod" concern | Yes — only the *prompt text* changes; tools and pipeline are still defined by what's deployed |

The "works in voice-test, breaks in prod" concern only applies when *more than
the prompt text* differs between the test and prod environment. The pull model
fetches the same `compiledInstructions` value from the same row in the same
database whether the call came from the dashboard's voice-test or from a real
inbound call. There's nothing for the two to diverge on.

### Why a separate endpoint, not `GET /api/agents/:id`

Two reasons:

1. **Auth shape.** `GET /api/agents/:id` is user-JWT-authenticated. The voice
   worker only has an agent API key. Forking an agent-authenticated route
   keeps the user-facing endpoint's permission model unchanged.
2. **Wire format.** The user-facing endpoint exposes `integrationUrls`,
   `secrets` ref map, ElevenLabs flags, `evalSuiteCount`, etc. — none of which
   the worker needs and several of which (`secrets`) should never travel over
   an agent-auth channel. The runtime-config endpoint returns the minimum the
   worker needs and nothing else.

### Why a separate prototype agent, not modifying the BuildPro example

The BuildPro example is the reference implementation for *production* features
— SIP, Langfuse tracing, 11 MCP tools, hangup state machine, transcript
posting. Bolting runtime-prompt-fetch onto it would either obscure the
demonstration (the freshness loop drowns in the SIP setup) or fork it (now
there are two versions of BuildPro that disagree on prompt source). A
single-purpose prototype keeps the demonstration clean and lets us evolve the
two examples independently. When operators want both runtime-prompt-fetch
*and* tools, they copy from both — the README spells that out.

### Endpoint shape

`GET /api/agents/me` — middleware: `requireAgent()`.

| Status | Condition |
|---|---|
| 200 | success, returns `AgentRuntimeConfig` |
| 401 | no API key, or API key isn't agent-scoped, or agent inactive |
| 404 | agent record was deleted between API key issue and call (unreachable in practice; defence in depth) |

The endpoint is registered *before* `GET /api/agents/:id` in `agents.routes.ts`
so the literal `/me` wins routing. Hono's router would also reject `/me` as a
non-UUID via the `:id` param's Zod schema, but explicit ordering is the safer
contract.

### Security

- **No secrets in the response.** Helper strips `secrets` (ref map) and
  `metadata.webhook_hmac_secret` defensively. Pinned by
  `tests/unit/agents/agent-runtime-config.test.ts`.
- **Agent API key auth + RLS.** `getAgentRuntimeConfig` runs inside `forOrg`,
  so even if a malformed API key ever crossed orgs (it shouldn't, by
  construction), Postgres-level RLS would 404 the lookup.
- **No `slug` rewrite.** The endpoint echoes `agent.slug` verbatim — same
  contract as the voice-test dispatch metadata (ADR-014). A worker that wants
  to defensively assert "I'm running for the slug I was dispatched as" can
  compare `cfg.slug` against `dispatch.agent_slug`.

## Alternatives Considered

**Re-open ADR-014's `prompt_override` proposal.** Rejected — its consequences
section spelled out the exact reason: the prompt becomes inconsistent with the
worker's tool set, so a passing voice-test no longer guarantees production
behaves the same. The pull model doesn't have this property: the same
`compiledInstructions` runs in every dispatch.

**MCP resource (`GET resources/agent_config`).** Rejected for the prototype.
The BuildPro example already opens an MCP connection for tool execution, but
introducing a runtime-config resource over MCP couples prompt freshness to
the MCP transport's lifecycle (initialize, resources/read, etc.) and adds a
spec-layer schema for a single payload. A REST call is simpler and reuses the
auth + RLS we already have. If/when the prototype graduates to tools, we can
revisit whether to fold runtime-config into the MCP resources catalog.

**Worker-side polling.** Rejected. Polling either races with a Compile-then-Talk
(stale prompt for the first call after a recompile) or wastes API quota when
nothing changes. Fetch-on-connect is the simplest version of "freshness only
where it matters."

**Push from API to all live workers on Compile.** Rejected — LiveKit Cloud
workers don't expose a control-plane API for that, and even if they did, the
prototype already gets fresh-per-call which is sufficient. There's no need
for hot-reload mid-call.

## Consequences

- **The Compile-then-Talk loop is fast.** Operator edits the prompt → clicks
  Compile (~1s) → clicks Talk to agent (~2s dispatch + connect) → talks to the
  agent running the just-compiled prompt. No worker rebuild, no LiveKit Cloud
  redeploy, no waiting for a CI build.

- **A new contract spans the TypeScript/Python boundary.** The wire format of
  `GET /api/agents/me` is consumed by code in two languages with no shared
  type system. Both sides pin the contract:

  - TS: `tests/unit/agents/agent-runtime-config.test.ts` (formatter shape)
  - TS: `tests/integration/agents.test.ts` (HTTP wire contract)
  - Python: `tests/test_runtime_config.py` (parser + fallback chain)
  - Python: `tests/test_mg_client.py` (REST headers/paths)

  If either side drops a field, the matching test on the opposite side fails.

- **The prototype is the simplest possible agent.** No tools, no SIP, no
  Langfuse, no transcript posting. It serves one purpose: prove the freshness
  loop. The BuildPro example stays as the production reference. The README
  documents how to combine them.

- **`compiledInstructions` is now a public surface.** Anything that mutates it
  has to consider: this string ends up as the worker's system prompt on the
  next dispatched call. The compiler service already treats it that way, but
  any future code path that writes to the column (data backfill, manual
  override, SOP republish) needs the same scrutiny.

- **Agent-deactivation has teeth.** The endpoint runs through `requireAgent()`,
  which 401s when `agent.isActive === false`. If an operator deactivates an
  agent mid-call to "kill" a runaway worker, the *next* call's runtime-config
  fetch fails and the worker can't boot — useful kill switch.

## Related

- ADR-011: LiveKit Outbound Calls — original dispatch pattern.
- ADR-014: Browser Voice Testing — the click-Talk dispatch flow this ADR
  extends, and the source of the rejected push-via-metadata alternative this
  ADR replaces.
- `examples/agents/livekit-prototype-agent/` — the prototype agent that
  consumes this endpoint.
- `examples/agents/livekit-agent/` — the BuildPro reference agent, still the
  template for production-shaped agents with tools.
