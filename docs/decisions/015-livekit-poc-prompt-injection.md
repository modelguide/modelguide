# ADR-015: LiveKit POC Worker with Prompt-from-Dispatch

**Status:** Proposed

## Context

ADR-014 ("Browser Voice Testing via LiveKit Dispatch") explicitly rejected
prompt injection in dispatch metadata. The reasons it gave are still
correct for the **production** voice-test path:

- The worker's profile is the authoritative source of prompt + tools.
  Injecting a different prompt creates a "works in voice-test, broke in
  prod" failure mode.
- Byte-size guards add complexity.
- "Build a new profile on the worker" is the right answer for prod.

This ADR does not contest any of that. It addresses a different need
that surfaces during the very first hours of a new agent build, before a
production worker profile exists at all:

- An operator pastes / generates a prompt in the dashboard.
- They hit **Compile Prompt**, see the IR.
- They want to **hear** the prompt right now — not after building, deploying,
  and registering a profile on the production worker.

Existing options for that loop:

1. Drive `examples/agents/livekit-agent/` locally with the prompt
   hand-pasted into `prompts/base.py` and a reload — heavy, requires
   three terminals + an .env, breaks the "test it from the UI" promise.
2. Stand up a one-off "scratch" worker for the prototype, give it a
   profile, point the MG agent at it, redeploy on every prompt change
   — every iteration ships a docker image.
3. Hardcode a default prompt on a minimal worker and live with the fact
   that prompt edits don't take effect — defeats the purpose of compile.

None of these match "compile → click → talk."

The closest existing reference is
[voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox) — a
single-purpose voice-agent boilerplate that takes its instructions per
session rather than per build.

## Decision

Ship a second LiveKit worker, `examples/agents/livekit-poc/`, that exists
specifically for the "compile → click → talk" prototype loop. It runs
side-by-side with `examples/agents/livekit-agent/`; neither replaces the
other.

### Differences from the production worker

| | `livekit-poc` | `livekit-agent` |
|---|---|---|
| Tools / MCP | none | full ModelGuide MCP |
| System prompt source | dispatch metadata, fallback to default | baked into the image |
| Tracing | none | Langfuse OTel |
| Files | 4 source files | ~10 + workflow modules |
| Failure mode | "prod drift impossible" — POC never IS prod | possible drift if a worker isn't redeployed |

### Opt-in per agent

The injection is opt-in via a per-agent flag stored in
`agent.metadata.livekit.injectCompiledPrompt`. The default voice-test
endpoint (`POST /agents/:id/voice-test-token`) only writes
`instructions` to dispatch metadata when the flag is true:

```ts
const injectPrompt = lkMeta.injectCompiledPrompt === true;
const dispatchMetadata = buildVoiceTestDispatchMetadata({
  agentSlug: agent.slug,
  sessionId: session.id,
  callerEmail: caller.email,
  instructions: injectPrompt ? agent.compiledInstructions : undefined,
});
```

Production agents leave the flag off and continue to behave exactly per
ADR-014 — the worker uses its baked-in prompt, no drift is possible.
Agents flagged on are the ones the operator has explicitly marked as
"this is the POC worker, pull the latest compile each time."

### Dispatch payload

`buildVoiceTestDispatchMetadata` now accepts optional `instructions` and
`greeting`:

```json
{
  "mode": "voice-test",
  "agentName": "<agent.slug>",
  "session_id": "<session.id>",
  "user_identifier": "<caller.email>",
  "email": "<caller.email>",
  "instructions": "<freshly compiled prompt>",
  "greeting": "<optional opener>"
}
```

The fields are omitted (not nulled) when not provided so the worker can
use a single `if md.instructions:` truthy check.

### Size cap

`instructions` is capped at 48 KB (UTF-8 bytes). LiveKit caps dispatch
metadata at 64 KB; the cap leaves ~16 KB for the rest of the payload and
headers. Over-cap prompts are **dropped, not truncated** — a half-prompt
would have the LLM obey a mangled rule set, strictly worse than no
prompt at all (the worker falls back to its default).

The byte-cap test asserts this in two ways:

- A 48 KB+1 ASCII string is dropped.
- A 48 KB+4 UTF-8-emoji string is dropped (byte cap, not char cap, so a
  multi-byte payload can't slip past).

### Cross-language contract

The TS test `tests/unit/agents/voice-test-dispatch.test.ts` and the
Python test `examples/agents/livekit-poc/tests/test_metadata.py` are
two halves of the same contract:

- TS asserts what the API **writes**.
- Python asserts what the worker **reads**.

If anyone renames a field, one of the suites breaks. There's no shared
type system between the two sides — these tests ARE the type.

## Alternatives Considered

**Add `instructions` to all voice-test dispatches (no opt-in flag).**
Rejected because every legacy / production worker would then receive
the field. Even though they ignore it today, the field's mere presence
becomes a trap for the next person who reads "oh, the prompt is in
metadata — let me use it" and introduces the ADR-014 drift mode.

**A separate endpoint `POST /agents/:id/voice-test-poc-token`.**
Rejected because it duplicates token generation, session creation, and
dispatch — three things that are already tested. A single endpoint with
a per-agent opt-in is the smaller blast radius.

**Fetch the prompt over HTTP from the worker (using the agent's API
key).** Considered, rejected for the POC: adds a round-trip on cold
start (already the slowest part of the "Talk" click), and the API key
distribution problem on the worker side is annoying. Dispatch metadata
is already a privileged channel the API controls; piggybacking on it is
the smallest change.

**Bake the prompt into the worker image on every compile.** This is the
ADR-014 answer and remains the right one for production. The POC's
purpose is to skip that step during prototyping.

## Consequences

- A new worker (`examples/agents/livekit-poc/`) exists alongside the
  production one. Both are templates; neither is "the platform answer."
  Docs make the distinction explicit so an operator picks the right
  one.
- The opt-in flag adds one bit of state to the agent record but no DB
  migration — it sits inside the existing JSONB `metadata.livekit`
  blob. Flipping the flag is a single PUT to the LiveKit config endpoint.
- ADR-014's "no prompt injection" remains the contract for any agent
  without the flag set. The drift failure mode it warned against can
  only happen if the operator deliberately opts in.
- The 48 KB cap is a hard ceiling on POC prompt size. The compiler's
  voice budget is 2,500 tokens (~10 KB) so this is well above the
  practical limit; the cap exists for safety, not normal operation.
- We get the "compile → click → talk" loop the website prototype has
  always had, without any production code path changing behaviour.

## Implementation Pointers

- API change: `modelguide-api/src/features/agents/agents.service.ts`
  — `buildVoiceTestDispatchMetadata` + `createVoiceTestSession`.
- POC worker: `examples/agents/livekit-poc/` (4 source files + 2 test
  files).
- Contract tests:
  - TS: `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts`
  - Python: `examples/agents/livekit-poc/tests/test_metadata.py`
- README: `examples/agents/livekit-poc/README.md`.
