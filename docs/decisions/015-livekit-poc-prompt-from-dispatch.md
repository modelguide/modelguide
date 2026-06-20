# ADR-015: livekit-poc — Prompt from Dispatch Metadata

**Status:** Accepted (POC)

## Context

ADR-014 stood up browser voice testing for LiveKit agents: the
dashboard "Talk to agent" button creates a session, dispatches the
configured worker into a fresh room, and joins from WebRTC. It works.
But it deliberately punted on a workflow we keep wanting:

> Compile a new prompt in the dashboard, click Test, hear the new
> prompt come back at you.

ADR-014 cited two reasons for the punt:

1. **Drift in testing.** Injecting an ad-hoc prompt into a worker
   creates a "works in voice-test, broke in prod" failure mode.
2. **Byte budget.** A naive injection adds ~100 lines of caps and
   guards (the 48KB LiveKit dispatch metadata cap, a 50K char prompt
   cap) plus a story for what happens when the prompt is too big.

That reasoning still holds for the **production** voice agent
(`examples/agents/livekit-agent/`), whose prompt and tool wiring are
co-designed. Sending it a foreign prompt at runtime would actually
break things — the prompt references tools by name, the tool transforms
expect specific phrasings, etc.

But the same reasoning does NOT hold for a **prototype** worker whose
sole job is "be a voice loop for whatever prompt you're handed". The
public-website voice-demo agent already operates that way; we just
don't have an in-platform equivalent. The result: anyone wanting to
hear how a freshly compiled prompt sounds either
(a) deploys a new worker (~minutes round trip) or
(b) tests against the public website outside the dashboard.

Both are slow enough that prompt iteration happens elsewhere and the
dashboard's prompt compiler stays under-used.

## Decision

Ship `examples/agents/livekit-poc/` — a thin, opt-in LiveKit worker
that reads its system prompt from the dispatch metadata when present
and falls back to a baked-in default otherwise. To make this work
end-to-end, extend the voice-test dispatch payload from ADR-014 with
one new optional field:

```jsonc
{
  "mode": "voice-test",
  "agentName": "<agent.slug>",
  "session_id": "<mg session>",
  "user_identifier": "<caller email>",
  "email": "<caller email>",
  "instructions": "<compiled prompt>"   // NEW — present when agent.compiledInstructions is set
}
```

### Why this is not the ADR-014 ban revisited

ADR-014 rejected prompt injection for the **production** dispatch path:
mutating the deployed worker's authoritative prompt at runtime. ADR-015
is about an **opt-in worker pattern**: a worker (the POC) that
voluntarily reads the field and uses it. The production worker
(`buildpro`) doesn't read the field and behaves identically to before.

The two ADRs coexist:

| | ADR-014 (production) | ADR-015 (POC) |
|---|---|---|
| Worker | `livekit-agent/` (BuildPro Sam) | `livekit-poc/` |
| Prompt source | Baked into worker image, per-profile | Dispatch metadata > default |
| Tools | 11 MCP-backed (cart, orders, …) | None (conversation only) |
| Use case | "Talk to the production agent" | "Hear my new compiled prompt" |
| `instructions` in dispatch | Ignored | Read |

The dashboard auto-routes on the agent's configured `metadata.livekit.agentName`
— so an operator picks which mode they're in by which worker the agent
points at. There is no flag, no conditional, no special endpoint.

### What the API side does

`buildVoiceTestDispatchMetadata` (in `agents.service.ts`) gains one
optional input — `compiledInstructions` — which it includes verbatim
as the `instructions` field when non-empty. The helper is otherwise
unchanged. `createVoiceTestSession` passes `agent.compiledInstructions`
through.

This is additive: workers that ignore the field still receive the
4 fields they always did. The five existing TS tests for
`buildVoiceTestDispatchMetadata` (key shape, agentName routing, JSON
round-trip, etc.) still pass without modification.

### What the worker side does

`prompt_resolver.resolve_instructions` decides the system prompt with
this priority:

```
explicit override (--metadata flag, tests)
  > dispatch metadata `instructions` (non-empty string)
    > baked-in default (DEFAULT_INSTRUCTIONS)
```

The resolver is pure (no I/O, no env reads) and is the load-bearing
piece on the worker side. It is covered by 17 unit tests in
`examples/agents/livekit-poc/tests/test_prompt_resolution.py`.

### The contract is two test files

There is no type system connecting the TS API to the Python worker.
The end-to-end contract is locked by two test files:

- `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts` —
  pins the API encoding (`instructions` field, empty-string handling,
  JSON round-trip, key-shape regression).
- `examples/agents/livekit-poc/tests/test_prompt_resolution.py` —
  pins the worker decoding (priority order, malformed-JSON safety,
  non-string-field rejection).

The two were written red-first against each other. If either side
drifts, one of these files goes red in CI.

### Size guards

We did NOT add an explicit byte cap on `instructions`. Rationale:

- The LiveKit dispatch metadata blob is capped at 48KB by the
  server. Compiled prompts are O(few KB) in practice; even a 50KB
  prompt would only fail at dispatch time with a clear LiveKit error.
- The 50K char cap that ADR-014 cited would have been an extra
  failure mode to document. Skipping it in the POC keeps the diff
  minimal and pushes the cap discussion to "when the POC graduates".

If a future operator dispatches a 100KB prompt and it gets truncated
at the LiveKit edge, the failure is loud (HTTP 4xx at dispatch time),
not silent. That's an acceptable POC trade-off.

## Consequences

### Positive

- **5-second iteration loop.** Compile prompt → click Talk → hear the
  prompt. No worker redeploy.
- **No production impact.** The production worker is unchanged. The
  new field is optional both ways.
- **Cheap to delete.** If we never extract the POC into the
  production worker, we delete the POC directory and the API field —
  the JSON payload is back to the ADR-014 shape with no schema
  migration.
- **Two-file contract is testable.** The two-test-file pattern
  worked for `agentName` in ADR-014; we reuse it for `instructions`.

### Negative

- **Two voice-test code paths.** Operators have to know which worker
  their agent points at — production (baked prompt) or POC (compiled
  prompt). Today this is implicit in the `metadata.livekit.agentName`
  config. Future work: surface the difference in the dashboard's
  LiveKit card ("This agent uses the POC worker — Voice Test will
  use your compiled prompt").
- **No tool wiring.** The POC can't exercise MCP tools, so it doesn't
  prove "the compiled prompt will work end-to-end with my connectors".
  This is by design — the POC is for "how does this sound", not "does
  this end-to-end work". Reaching for the production worker remains
  the right answer for tool flows.
- **OpenAI Realtime dependency.** The POC uses OpenAI's Realtime API
  for the audio loop. Outage of that endpoint hurts the POC; the
  production worker (which chains Deepgram + GPT + ElevenLabs)
  doesn't share the dependency.

### Known unknowns

- **Graduation path.** If the POC pattern proves out, the cleanest
  graduation is to add the `resolve_instructions` call to
  `MCPAgent.__init__` in the production worker as an opt-in
  constructor flag (`accept_dispatch_prompt=True`), defaulting to
  False. Existing profiles keep their baked prompt; new profiles can
  opt in.
- **Multi-profile workers.** `agentName` routing (ADR-014) and
  `instructions` injection (this ADR) are independent. A future
  multi-profile POC worker that wants both works without further
  protocol changes.

## Alternatives considered

**Add a new `/voice-test-token-poc` endpoint with prompt injection.**
Rejected — duplicates the dispatch/session-create/token-mint flow
and makes the dashboard have to know "which endpoint for which
worker". The opt-in-on-worker approach keeps the API surface flat.

**Embed the prompt in the AccessToken (JWT) instead of dispatch
metadata.** Rejected — tokens are user-facing (they go to the
browser); putting a system prompt there is a small leakage of agent
internals. Metadata stays server-side until the worker reads it.

**Reach for the public website's voice demo from the dashboard.**
Rejected — would couple the dashboard to a separate deployment and
break when the website is down. Owning the POC inside the platform
is worth the maintenance cost.

**Make `livekit-poc` literally `voiceblox` vendored in.** Rejected —
the voiceblox layout is great, but our existing
`examples/agents/livekit-agent/` already shows the LiveKit-Cloud
patterns we want (entrypoint shape, session lifecycle, transcript +
session-completion REST calls). Taking inspiration without vendoring
keeps the dependency tree clean and the operator's "this looks like
the other one" intuition intact.

## Related

- [ADR-014: Browser Voice Testing via LiveKit Dispatch](./014-browser-voice-testing.md) — the dispatch + token pattern this extends.
- [ADR-011: LiveKit Outbound Calls](./011-livekit-outbound-calls.md) — the original dispatch pattern.
- `examples/agents/livekit-poc/README.md` — the local dev loop.
- `examples/agents/livekit-poc/tests/test_prompt_resolution.py` — the
  worker half of the dispatch contract.
- `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts` — the
  API half of the dispatch contract.
