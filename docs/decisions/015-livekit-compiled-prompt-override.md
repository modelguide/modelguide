# ADR-015: Compiled-Prompt Override for LiveKit Voice Testing

**Status:** Accepted — POC (supersedes ADR-014 §"What this deliberately does NOT do")

## Context

ADR-014 established the browser voice-test flow: click "Talk to agent", the API mints a short-lived token and dispatches the configured LiveKit worker into a fresh room, the browser joins via WebRTC. The worker uses whatever system prompt is baked into its profile module (`prompts/base.py` in `examples/agents/livekit-agent`).

That was good enough when ModelGuide was a thin shim around an externally-developed worker. It is **not** good enough as the dashboard becomes the source of truth for agent configuration:

1. The dashboard exposes a "Prompt" section (`prompt-section.tsx`) where operators edit `promptConfig` (persona, language, filler phrases).
2. The "Compile" button (`compile-dialog.tsx`) runs the compiler pipeline (SOPs + guardrails + promptConfig → `compiledInstructions`) and persists the result on the agent row.
3. Until this ADR, that `compiledInstructions` field was **dead data** in the voice-test loop. The worker never read it. Operators had to redeploy a profile to test their edit, which kills the iteration loop the dashboard exists to enable.

ADR-014 explicitly rejected prompt injection. The original rejection rested on three premises that no longer hold:

| Premise (ADR-014) | What changed |
|---|---|
| "The worker's profile is the authoritative source of prompt + tools." | No longer true for the platform path. The MG agent record (with `promptConfig` + `compiledInstructions`) is the source of truth; the worker's baked profile is a fallback for raw/local development. |
| "Creates a 'works in voice-test but broke in prod' failure mode." | Only true if production uses a different prompt than voice-test. With this ADR, the **same** `compiledInstructions` is used by voice-test and (once redeployed) by production. The override is the rehearsal, not a divergence. |
| "Build a new profile on the worker to test a new prompt." | Acceptable for first-party demo work, hostile to platform users who never touch worker code. |

## Decision

When dispatching a voice-test session, include the agent's current `compiledInstructions` in the dispatch metadata under the key `instructions`. The worker checks for that field at startup and, when present, uses it instead of its baked profile prompt for the duration of the call.

### Dispatch contract (extends ADR-014)

```jsonc
// POST /agents/:id/voice-test-token → LiveKit AgentDispatchClient metadata
{
  "mode": "voice-test",
  "agentName": "<agent.slug>",          // worker-profile routing (ADR-014)
  "session_id": "<session.id>",
  "user_identifier": "<caller.email>",
  "email": "<caller.email>",
  "instructions": "<compiled prompt>"   // NEW — optional, omitted when:
                                         //   - agent.compiledInstructions is null
                                         //   - the string is empty/whitespace
                                         //   - the UTF-8 byte length exceeds
                                         //     VOICE_TEST_INSTRUCTIONS_MAX_BYTES (32 KB)
}
```

The contract is locked behind `tests/unit/agents/voice-test-dispatch.test.ts` on the API side and `tests/test_instructions_override.py` on the worker side. The two sides must agree on what counts as "no override" — a whitespace-only string falls back to the baked prompt on both sides.

### Why a size guard

LiveKit's dispatch metadata is JSON-stringified and shipped over the control channel. There's no published hard limit, but practical payloads should stay well under ~32 KB to avoid risking dispatch fragmentation. A typical compiled prompt is 3-8 KB; 32 KB is comfortable headroom. When the guard trips, the API logs a structured warning (`"voice-test: compiled prompt dropped from dispatch metadata (size guard)"`) and the worker falls back to its baked prompt — operator hears the **previous** prompt rather than no audio at all.

The guard sizes by UTF-8 byte length, not JS character count: a single emoji is 1-2 chars in JS but 4 bytes on the wire. A naive `.length` check would let a 64KB-on-the-wire payload sail through.

### Worker side

`MCPAgent.__init__` gains an optional `instructions_override: str | None` parameter. The base class wires it through a pure helper, `resolve_instructions(default, override) → str`, that mirrors the API's "no override" rules. The override path logs a single info-level breadcrumb ("Using compiled-prompt override from dispatch metadata (N chars, baked default ignored)") so operators triaging "did my edit go through?" can grep the worker log.

The entrypoint (`agent.py`) extracts the field via another pure helper, `extract_instructions_override(metadata) → str | None`, that defends against missing keys, wrong types, and non-dict metadata. Same shape as the API guard so the two sides agree on what to do with garbage input.

### UI surface

`VoiceTestPanel` gains a `CompiledPromptIndicator` line that shows either:
- "Will use prompt compiled <timestamp>" (when `compiledInstructions` is set), or
- "No compiled prompt — worker will use its baked-in profile" (when null).

This closes the feedback loop. Operators see exactly which compile cycle they're about to test before they click Talk.

## Alternatives Considered

**Add a `POST /agents/:id/voice-test-token?override=true` query flag** to opt into prompt injection.  Rejected — the dashboard is the source of truth; the override should be the default, not an opt-in. A flag would invite "I always forget to set the flag and wonder why my edit doesn't show up" friction.

**Ship the override via a server-sent event or websocket** after the agent joins the room.  Rejected — dispatch metadata is already JSON-serialized and atomic with the join. Adding a second channel doubles the failure surface (what happens if the SSE drops before the prompt arrives?) for no benefit.

**Store the override in a Redis cache and pass an ID via metadata.**  Rejected — adds an infrastructure dependency and a race window between dispatch and the agent's fetch. A 32 KB inline payload is well within what LiveKit dispatch is designed for.

**Reject overrides above the size guard with a 400 from the API** instead of silently dropping.  Rejected — the operator would lose the ability to voice-test at all when their prompt is oversized. The dashboard already shows the compiled prompt size in `CompileSummaryBar`; a structured log warning is sufficient for the rare case where the guard trips. If oversized prompts become common, revisit by streaming the prompt over a side channel rather than blocking the user.

## Consequences

- The dashboard "Compile → Talk to agent" cycle now does what the labels suggest. Iteration time drops from a redeploy (minutes) to a click (seconds).
- The 32 KB size guard is now load-bearing. If a future compiler emits prompts that routinely cross 32 KB, the silent-fallback behavior will be confusing ("my prompt is huge and I'm hearing an old version"). Mitigation: surface dropped-override warnings in the UI (future hardening; out of POC scope).
- The worker still works fine without the override — `instructions_override=None` falls back to the baked prompt. Local development with `make lk-agent-dev` is unaffected: there's no MG dispatch in that path, so no metadata, so no override.
- This ADR supersedes ADR-014's "no prompt injection" stance. The contract still lives in the same dispatch-metadata schema and the same pure-function unit tests — adding a field is a controlled extension, not a redesign.
- ElevenLabs and other future platforms are unaffected: the override lives in LiveKit dispatch metadata, which has no analog on the ElevenLabs side. When/if we add the equivalent for ElevenLabs, it'll come with its own ADR.

## Rollback

To revert to the ADR-014 behavior:
1. Drop the `instructions` field from `buildVoiceTestDispatchMetadata` (API).
2. Drop the `instructions_override` parameter from `MCPAgent.__init__` (worker).
3. Both sides' unit tests will fail loudly — the contract regression is caught by CI.
