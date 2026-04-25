# ADR-015: LiveKit Worker Pulls Compiled Prompt at Session Start

**Status:** Accepted

## Context

ADR-014 ("Browser Voice Testing via LiveKit Dispatch") wired up the one-click "Talk to agent" panel: the dashboard hits `POST /api/agents/:id/voice-test-token`, the API mints a LiveKit token + dispatches the worker, and the browser joins a room over WebRTC. That flow works end-to-end except for one rough edge:

> The deployed worker uses whatever prompt was baked into its Docker image at build time.

So the dashboard can compile a brand-new prompt (the `compileAgent` route writes `agent.compiledInstructions`), and the user can click "Talk to agent" — but they will be talking to a worker that's running an unrelated prompt from `examples/agents/livekit-agent/src/prompts/`. The compiled prompt only takes effect on the next deploy. That defeats the "compile → test" loop the dashboard advertises.

ADR-014 explicitly rejected putting the prompt into LiveKit dispatch metadata (the worker would receive `instructions_override` as a string in `JobContext.job.metadata`). Two reasons:

1. Dispatch metadata is bounded by LiveKit (~48 KB) and a long compiled prompt easily blows that budget without size guards.
2. It moves prompt authority into the request path: a buggy or hostile dashboard call can ship arbitrary instructions to a production worker. The dispatch path is the wrong place to enforce "the worker only runs prompts that belong to this agent."

So the per-test prompt-injection idea was killed. The gap remained.

## Decision

The deployed worker **pulls** its compiled prompt from ModelGuide at session start, instead of having it pushed via dispatch metadata.

### Endpoint

`GET /api/agents/me/runtime` — auth: agent's own `mgk_` API key (the same key the worker already holds in `MODELGUIDE_API_KEY` for MCP tool calls).

The "me" path segment matters: the API key uniquely identifies the agent, so the worker doesn't have to know its own UUID, and we never accept an `agentId` argument from the network on this route. RLS still scopes the lookup by `auth.agent.organizationId`.

Response body:

```jsonc
{
  "id": "uuid",
  "organizationId": "uuid",
  "name": "Sam",
  "slug": "buildpro-sam",
  "modality": "voice",
  "modelFamily": "gpt",
  "agentPlatform": "livekit",
  "promptConfig": { "persona": "...", "language": "en", "fillerPhrases": [...] },
  "compiledInstructions": "You are Sam ...",   // null if never compiled
  "compiledAt": "2026-04-25T12:00:00.000Z"      // null if never compiled
}
```

### Worker integration

`agent.py`'s `entrypoint()` calls `mg_client.fetch_runtime()` once per job, right after the ModelGuide session is created. The compiled prompt is interpolated against the same runtime placeholders the local template uses (`{{mg_session_id}}`, `{{userEmail}}`, `{{channel}}`) and passed to `BuildProAgent` as `instructions_override`. If the fetch fails (network, 4xx, 5xx) **or** the agent has no compiled prompt yet, the worker falls back to the local `prompts/` package and logs the fact.

### What this deliberately is

- A **pull** at session start. One HTTP call per call. Prompt is current as of "the moment the user clicked Talk to agent."
- An **agent-scoped** lookup. The API key authenticates the call; the agent identity is implicit. There is no path where worker A can fetch agent B's prompt.
- A **graceful fallback**. A new agent that has never been compiled is still a valid runtime target — the endpoint returns `compiledInstructions: null` (200, not 404) so the worker can choose to fall back rather than crash the call.

### What this is not

- Not a fix for ADR-014's "no prompt injection in dispatch metadata" stance. Dispatch metadata still carries only `agentName`, `session_id`, `user_identifier`, `email`. The prompt never travels through the dispatch path.
- Not a "hot reload mid-call" mechanism. A re-compile during an active call has no effect on that call. It will be picked up by the next call.
- Not a replacement for the ElevenLabs sync flow (`agents.sync.ts`). ElevenLabs requires the prompt to be pushed to its own platform; LiveKit workers run our own code, so they can pull directly.

## Alternatives Considered

**Push the prompt via LiveKit dispatch metadata.** Rejected by ADR-014 (size cap, prompt-authority-in-the-request-path). Still rejected.

**Rebuild + redeploy the worker on every compile.** Rejected — turns a one-second feedback loop into a multi-minute build + deploy + warm-up. Defeats the dashboard's "compile → test" promise.

**Cache the compiled prompt in the worker process and refresh via webhook.** Rejected for now — adds a webhook endpoint, retry logic, and cache invalidation for a feature that doesn't yet need it. The pull pattern is one HTTP call (~50 ms locally, ~200 ms cross-region) and is fired in parallel with MCP connection setup. If profiling shows it on the critical path, we can layer a cache later.

**Add a separate "deployed-prompt-version" header so the worker can ETag-skip the body.** Rejected — premature. The compiled prompt is small (single-digit KB for current SOPs); we are not going to optimize a sub-millisecond response with conditional GETs unless there's evidence we should.

**Encode the agentId in the URL (`GET /api/agents/:id/runtime`) and require both the API key and the ID to match.** Rejected — the API key already identifies the agent uniquely. Adding an ID introduces an attack surface ("can I pass agent B's ID with agent A's key?") that we'd have to defend with a guard. `me` removes the question entirely.

## Consequences

- **Compile → click → talk** now actually tests the latest compiled prompt. The deploy step disappears from the inner loop.
- **One extra HTTP call per voice session.** Fires in parallel with MCP init, so the wall-clock impact is bounded by the slower of the two (MCP setup is the long pole). Logged via the existing `mg_client` httpx instance, so it shares the connection pool.
- **A new public-API surface for agents.** The endpoint is small and frozen-by-design (worker contracts are awkward to evolve), but it is now a contract — breaking changes need a version field or a parallel route.
- **Brand-new agents that haven't been compiled still work.** They fall back to whatever prompt the worker shipped with — same behavior as before this ADR. The "Compile a prompt before testing" guidance in the dashboard is now soft, not hard.
- **Agent slug renames don't break the runtime fetch.** Unlike the dispatch-metadata path (where the worker matches `agentName` against an in-memory profile registry — see ADR-014), the runtime fetch is keyed off the API key and returns whatever name/slug ModelGuide currently has.
- **The "Talk to agent" demo can be reused as a sales artifact** without a per-customer worker rebuild — the underlying worker image is generic, customer-specific behavior comes from the SOPs/prompt that the dashboard owns.

## Tests

| Layer | Test | What it locks down |
|---|---|---|
| API integration | `tests/integration/agents-runtime.test.ts` | Endpoint exists, returns the right shape, requires an agent API key (rejects user JWT and anonymous), is RLS-isolated across orgs, and tolerates `compiledInstructions: null`. |
| Worker unit | `examples/agents/livekit-agent/tests/test_mg_client.py::TestFetchRuntime` | `fetch_runtime()` hits `GET /api/agents/me/runtime` and surfaces 4xx as `httpx.HTTPStatusError` (so `agent.py` can fall back). |
| Worker unit | `examples/agents/livekit-agent/tests/test_runtime_prompt.py` | `interpolate_runtime_prompt` substitutes the three runtime placeholders and is a no-op for prompts that don't use them. |

The integration test was written first (red) against an endpoint that didn't exist. Implementing `getAgentRuntime` + the route turned it green.

## Related

- ADR-005: SOPs as a Core Primitive — produces the `compiledInstructions` value this ADR consumes.
- ADR-011: LiveKit Outbound Calls — established the worker dispatch path.
- ADR-014: Browser Voice Testing — established the "Talk to agent" surface and explicitly rejected push-via-dispatch-metadata. This ADR closes the prompt-freshness gap that ADR-014 left open by going pull instead of push.
