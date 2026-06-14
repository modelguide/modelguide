# ADR-015: LiveKit Voiceblox Prototype — Runtime Prompt Pull

**Status:** Accepted (prototype scope only)

## Context

The buildpro LiveKit agent (`examples/agents/livekit-agent/`) bakes its
system prompt into the Docker image: `prompts/base.py` + auto-discovered
files in `prompts/workflows/`. That's correct for production — the prompt
is versioned with the code, and the worker has a strong guarantee that
"what's running" matches "what's in the repo."

The cost of that design surfaces during prototyping. The dashboard ships
a full prompt-editing surface — Configuration tab (persona, language,
filler phrases), SOP forking and editing, **Compile Prompt** dialog, the
Compiled tab with diff viewer — but none of that reaches the buildpro
worker without a redeploy. The intended loop is

```
edit → Compile Prompt → Talk to agent → speak with the new prompt
```

and on the LiveKit side that loop is broken: the **Talk to agent**
button (added in ADR-014) dispatches a worker that's running the same
prompt it was deployed with, regardless of what the admin just compiled.

The ElevenLabs side already solves this differently: `POST /agents/:id/sync`
pushes the compiled prompt to ElevenLabs' platform via their REST API.
LiveKit Cloud doesn't have an equivalent "store this prompt and use it on
the next call" concept — workers own their own state.

ADR-014 considered and rejected one fix: shipping the compiled prompt
through LiveKit dispatch metadata as `prompt_override`. The two reasons
quoted there are still right:

> The worker's profile is the authoritative source of prompt + tools.
> Injecting a different prompt creates a "it works in voice-test but
> broke in prod" failure mode. It added ~100 lines of byte-size guards
> (50K char cap + 48KB metadata cap) to bound the injected prompt.

But there's a different shape of fix that ADR-014 didn't enumerate:
the worker **pulls** its prompt from ModelGuide at session start, rather
than the API **pushing** it through dispatch metadata.

## Decision

Add a prototype worker (`examples/agents/voiceblox-poc/`) that fetches
its system prompt from ModelGuide at session start, plus the API endpoint
that supports it.

### What ships

1. **`GET /api/agents/me`** — new endpoint, API-key auth. Returns a
   lean projection of the authenticated agent's runtime config:

   ```ts
   {
     id, name, slug, description,
     modality, modelFamily, agentPlatform, isActive,
     promptConfig,
     compiledInstructions,        // the only field the POC actually uses
     compiledAt, compiledFrom,
     metadata,
   }
   ```

   Notably **not** returned: `secrets` (refs only on the dashboard
   endpoint), `integrationUrls`, `evalSuiteCount`, `keyPrefix`,
   `hasElevenLabsKey`, `hasWebhookSecret`. A runtime worker doesn't
   need any of those, and shrinking the surface lets us reason about
   what an API-key holder can see.

   `webhook_hmac_secret` is stripped from `metadata` for the same
   reason it's stripped from the dashboard endpoint — legacy plaintext
   that should never leave the server.

2. **Voiceblox prototype agent** at `examples/agents/voiceblox-poc/`.
   On `JobContext.entrypoint()` it calls `fetch_agent_config()` →
   `GET /api/agents/me`, then boots `AgentSession` with the returned
   `compiledInstructions` as the system prompt.

   No connector tools, no SIP, no Langfuse — the POC's sole job is to
   validate the prompt-pull loop. Persona + language fields from
   `promptConfig` are appended after the compiled prompt so they
   reflect Configuration-tab edits too.

3. **Fallback to a baked-in default prompt** in three cases:
   `compiledInstructions === null` (agent not yet compiled), fetch
   raised, or any other unexpected shape. The call still connects;
   the source ("compiled" / "fallback-uncompiled" / "fallback-error")
   is logged so the operator can diagnose without a missed call.

### Why this is consistent with ADR-014

ADR-014 rejected **push** (metadata-injected prompt overrides) because
it creates drift between voice-test and prod. **Pull** doesn't have
that problem — the same code path runs in both cases. There's no
"override" branch in the worker; the worker just has one source of
truth, and that source happens to be the API.

The contract change is also smaller than the metadata-override
proposal: no byte-size guards, no dispatch payload growth, no special
"voice-test mode" branch on either side.

### Authentication model

API keys (`mgk_xxx`) are already scoped to a single agent (see
`apiKeys.agentId` in the schema, `requireAgent()` middleware). The
worker authenticates as **the agent itself**, and `GET /me` resolves
to that agent. No special "worker identity" or "session token" — the
existing API key is the worker's identity.

This means deploying a worker that serves agent X is exactly
`MODELGUIDE_API_KEY=<key for X>`. Serving two agents from one worker
binary is two `MODELGUIDE_API_KEY` envs across two LiveKit deployments
— no profile registry, no slug→profile mapping, just one key per
worker process.

## Alternatives Considered

**Bake the prompt at build time (status quo for buildpro).** Rejected
for the prototype — see Context. Keeping it for production-grade
buildpro is correct.

**Push compiled prompt via LiveKit dispatch metadata.** Rejected in
ADR-014. We're not revisiting that.

**Add a per-agent `/agents/:id/compiled-prompt` endpoint instead of
`/me`.** Rejected — the worker already knows its identity (it's the
agent the API key is scoped to). Requiring the worker to inject the
agent ID into URLs duplicates that information and creates a way for
the worker to be misconfigured (key scoped to A, but worker asks for
B's prompt and gets 404). `/me` makes the contract self-enforcing.

**`POST /agents/:id/sync` for LiveKit (mirror of ElevenLabs).**
Rejected — LiveKit Cloud has no platform-side prompt store to push
*to*. Any "sync" would be a no-op or would have to redeploy the
worker. Pulling at session start gets us the same end result with
less infrastructure.

**Cache the prompt on the worker side and refresh on a TTL.** Out of
scope for the POC. Worth revisiting if the fetch latency ever becomes
visible: in same-region deploys it's ~50ms, well under STT + LLM TTFT.
A stale-while-revalidate cache is the obvious upgrade if needed.

## Consequences

### What gets better

- Compile → talk loop now works for LiveKit agents. The dashboard
  reaches all the way to the worker without a redeploy.
- New agents can be onboarded by deploying one worker per agent and
  handing them an API key — no per-agent prompt files in the worker
  repo.
- The buildpro worker can adopt the same pattern incrementally: swap
  `build_system_prompt()` for `await fetch_agent_config()` and the
  rest of the BuildPro tools / hooks / transcripts continue to work
  unchanged.

### What costs more

- **One extra REST round-trip per session.** ~50ms in the same region;
  fires in parallel with `wait_for_participant()` in the current
  implementation, so the user-visible delta is ~0.
- **The dashboard becomes load-bearing for voice calls.** Today, a
  buildpro worker can serve calls even if the MG API is down (it
  loses session tracking but the call works). The voiceblox prototype
  falls back to a generic prompt in that case — strictly worse for
  prod, neutral for prototyping. If we ever promote this pattern out
  of `examples/`, the on-disk last-known cache mentioned above
  becomes mandatory.
- **The runtime config response shape is now a contract with the
  worker.** Changing it requires updating both the API schema and the
  worker's `mg_client.fetch_agent_config()` contract test in lockstep.
  This is no worse than the MCP tool naming contract we already have
  (`{connector_slug}_{tool_name}`); it's just one more.

### Scope guard

This ADR governs the prototype only. The buildpro example keeps its
bundled-prompt design. Promoting this pattern to "the way LiveKit
workers should work" is a separate decision, gated on:

1. The fallback behavior being adequate for production (probably
   means the disk cache above)
2. A migration story for moving buildpro's workflow prompts from
   `prompts/workflows/*.py` into ModelGuide SOPs without a regression
3. A re-read of ADR-014's "the worker's profile is the authoritative
   source" rationale in light of those changes
