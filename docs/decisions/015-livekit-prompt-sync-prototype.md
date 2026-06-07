# ADR-015: LiveKit Voice-Test with Compiled-Prompt Sync (Prototype)

**Status:** Proposed (prototype)

## Context

ADR-014 ships "Talk to agent" — one-click WebRTC voice testing against a
deployed LiveKit worker. It works well for verifying that the worker's
**baked-in** profile (prompt + tools) sounds right end-to-end. It does
not help when an operator is iterating on a **prompt** in the dashboard:
each edit currently requires building, pushing, and redeploying a new
worker profile before the change can be heard. The feedback loop is
minutes, not seconds.

The acme website (`examples/customer-apps/acme/src/App.tsx`) and the
[voiceblox](https://github.com/voiceblox-ai/voiceblox) reference both
support a tighter loop: edit a prompt, click sync, hear the result. We
want the same loop in ModelGuide for LiveKit-based agents.

ADR-014 deliberately rejected prompt injection on three grounds:

1. **Drift in testing.** "Works in voice-test, broken in prod" if the
   injected prompt differs from the deployed profile.
2. **Metadata size discipline.** LiveKit dispatch metadata is bounded
   (~48KB) and the prompt-injection patch was ~100 lines of byte-size
   guards.
3. **The "right" answer was to build a new profile.** Redeploy is the
   honest test.

This ADR re-opens that decision — narrowly, as an **opt-in prototype**
— because the redeploy-per-edit cost has turned out to be the dominant
friction in prompt work for operators on the platform.

## Decision

Extend `POST /agents/:id/voice-test-token` with an optional body field:

```json
{ "useCompiledPrompt": true }
```

When set, the dispatcher reads `agents.compiledInstructions` and
`agents.compiledAt` and adds them to the LiveKit dispatch metadata
under `compiled_prompt` and `compiled_prompt_compiled_at`. A
prompt-sync-aware worker reads these fields and uses the supplied
string as the agent's instructions instead of its baked-in prompt.

The default — no body, or `{ "useCompiledPrompt": false }` — is
byte-for-byte identical to ADR-014. The prototype rides alongside
the existing flow; nothing about the production "Talk to agent"
behavior changes unless the operator opts in.

### Wire contract

The dispatcher (`buildVoiceTestDispatchMetadata` in
`modelguide-api/src/features/agents/agents.service.ts`) emits this
JSON shape, which is also what the worker reads from
`ctx.job.metadata`:

```json
{
  "mode": "voice-test",
  "agentName": "<agent.slug>",
  "session_id": "<uuid>",
  "user_identifier": "<email>",
  "email": "<email>",
  "compiled_prompt": "<string, omitted when not opted in>",
  "compiled_prompt_compiled_at": "<ISO 8601, omitted when not opted in>"
}
```

The contract is locked by two paired tests:

- `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts`
  — covers the dispatcher side. New cases verify that the field is
  *absent* by default and *present and verbatim* when supplied.
- `examples/agents/livekit-agent/tests/test_prompt_sync.py`
  — covers the worker side. New cases verify that the field name
  matches the dispatcher, that an absent field falls back to the
  baked-in prompt, and that empty / whitespace-only overrides are
  ignored.

If either side drifts on the field name, both sides still compile and
pass type checks, but prompt-sync silently regresses to ADR-014
behavior. The two tests together are the type system between TS and
Python.

### Endpoint shape

`POST /agents/:id/voice-test-token`

Request body (optional):

```json
{ "useCompiledPrompt": true }
```

Behavior:

| `useCompiledPrompt` | `agents.compiledInstructions` | Result |
|---|---|---|
| `false` / omitted / no body | any | ADR-014 path — worker uses baked-in prompt |
| `true` | non-null | Prompt rides in dispatch metadata |
| `true` | `null` | **400** — must compile the agent first |

The 400 guard is the precondition that makes this safe to ship: an
operator never gets dispatched into a room with a half-baked agent
because the dashboard told the worker to use a prompt that doesn't
exist.

### What this deliberately keeps the same as ADR-014

- **The room, session, and token mint are identical.** The same
  `voice-test-<nanoid>` room, the same `agents:activate` permission,
  the same 15-minute token TTL, the same RLS-scoped secret load.
- **The worker-profile ↔ agent.slug routing contract is unchanged.**
  `agentName` still equals `agent.slug`. A multi-profile worker still
  picks a profile from its registry; the override only changes the
  instructions on that profile.
- **No new endpoints.** One body field, one opt-in.

### What this deliberately reverses from ADR-014

- The "no prompt injection, ever" rule. Now: prompt injection is
  allowed when the operator explicitly asks for it, and only when a
  compiled prompt exists for that agent.

## Alternatives Considered

**Worker fetches the prompt from a new ModelGuide REST endpoint.**
Cleaner separation, no metadata size pressure, prompt always fresh.
Rejected for the prototype because it requires the worker to hold a
long-lived MG API key and to learn about a new endpoint shape. The
current dispatch-metadata path requires zero new auth and ships in
one place.

**A new endpoint (`POST /agents/:id/prompt-sync-token`) alongside
the existing one.** Cleaner contract, easier to revert, fits "prototype
status" better. Rejected because it duplicates ~80% of the existing
endpoint's logic, and the opt-in flag is a one-bit change that does
not pollute the default path.

**A separate "prompt-test" agent in the worker.** Tested-in-isolation,
no contamination of the BuildPro profile. Rejected for the prototype
because then "test prompt" and "test live agent" diverge on STT/TTS
provider, voice, etc., and a difference there is the bug operators
hit first.

**Cap `compiled_prompt` size at 40KB.** Considered. Not yet enforced
in the prototype — most compiled prompts in production are well under
10KB. If we ship this beyond prototype, the cap goes in
`createVoiceTestSession` with a 400 if exceeded, and the dispatcher
test pins the cap.

## Consequences

- **Faster prompt iteration loop.** Edit → compile → "Talk to agent"
  → hear it. The redeploy step is skipped for prompt-only changes.
- **Same drift risk ADR-014 called out, now scoped.** "Works in
  voice-test, broken in prod" is still possible — the prototype
  doesn't *eliminate* the risk, it just makes it opt-in and signaled
  on the panel ("Prototype" badge). The mitigation is to follow
  prompt-sync testing with a normal voice-test against the deployed
  profile before shipping.
- **Metadata size discipline is now load-bearing.** No cap is
  enforced in the prototype. If an operator compiles a 60KB prompt,
  the dispatch will fail at the LiveKit edge. Acceptable for a
  prototype; not acceptable to ship.
- **The wire contract is now a two-sided type system.** A field-name
  rename on either side breaks prompt-sync without breaking any
  build. The paired tests in TS + Python guard against this; reviewers
  must keep them in sync.

## Graduation criteria

The prototype graduates to a real feature (rolling into ADR-014 or
replacing it) when:

1. A byte cap on `compiled_prompt` is enforced and tested.
2. The dashboard shows a visible "you are testing prompt X, deployed
   profile is on prompt Y" diff before the call so the drift risk is
   no longer hidden.
3. A small handful of operators report sustained use without
   complaining about drift.

Until then, the toggle stays opt-in and badged "Prototype" on the
panel.

## Related

- ADR-011: LiveKit Outbound Calls
- ADR-014: Browser Voice Testing via LiveKit Dispatch — the flow this
  extends
- `examples/agents/livekit-agent/PROMPT_SYNC.md` — worker-side usage
  notes
