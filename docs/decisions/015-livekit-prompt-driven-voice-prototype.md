# ADR-015: Prompt-Driven Voice Prototype for LiveKit

**Status:** Accepted

**Supersedes part of:** ADR-014 ("No prompt injection. Earlier iterations
shipped a `prompt_override` field in dispatch metadata… We rejected this…")
— for the prototype path only. ADR-014 still governs the production
"Talk to agent" flow unchanged.

## Context

The platform now has two LiveKit-shaped surfaces with different goals.

**Production "Talk to agent"** (ADR-014) exists to answer: *will the agent
that runs in production today behave correctly?* So the worker profile owns
the prompt + tool list, and the dispatch carries only correlation data
(`agentName`, `session_id`, `email`). Any prompt drift between the
admin's draft and the worker's reality is treated as a bug.

**Prompt iteration loop** is a different goal. An admin who's editing a SOP
or compiling a new prompt wants to hear *the prompt I just compiled*, not
*the prompt the worker happens to be running today*. The compile → sync →
test loop is the day-to-day reason ElevenLabs already exists in the
product (see `syncAgentToElevenLabs`). LiveKit didn't have an equivalent.
The user-reported pain point: "I've compiled a new prompt, I want to hear
it, but Talk-to-agent gives me yesterday's deployment."

ADR-014 deliberately rejected injecting the prompt into dispatch metadata
for the production path. The argument was sound — a prompt that works in
voice-test but not in prod is worse than the redeploy cost it avoids. That
argument doesn't carry over to a prototype surface that is explicitly
labelled as "what I just compiled, not what's running in prod."

## Decision

Add a **second, separate** voice path called Voice Prototype:

1. New API endpoint `POST /agents/:id/voice-prototype-token` —
   permission `agents:activate`, same auth + RLS posture as voice-test.
2. New dispatch builder `buildVoicePrototypeDispatchMetadata` — same five
   correlation fields as voice-test, plus `agent_id` and `compiled_prompt`.
   The shape is locked behind a unit test (see "Contract" below).
3. New Python entrypoint `examples/agents/livekit-agent/src/prompt_entry.py`
   that registers as LiveKit agent name `voice-prototype` and parses the
   dispatch metadata into a `PromptAgentConfig` *before* connecting to the
   room. Malformed metadata → fail fast (no dead-air).
4. New UI panel `<VoicePrototypePanel>` on the agent detail page,
   rendered below the existing `<VoiceTestPanel>`. Same WebRTC plumbing
   (mic-permission probe + `<LiveKitRoom>` + `RoomController`), different
   endpoint + label.

**Both panels render on the same page.** The operator picks the path that
matches their question: "does it work in prod?" → Talk to agent. "does my
latest compile sound right?" → Talk to prototype.

### What the prototype deliberately doesn't do

These omissions are the price of separating the prototype from production:

- **No tool calling.** The prototype is for prompt iteration, not full-
  stack tool regression. If a prompt change relies on a tool being wired
  correctly, exercise it through Talk-to-agent against a deployed profile.
- **No SIP / outbound calls.** WebRTC only. PSTN integration belongs in
  the production path.
- **No worker-side prompt validation.** The API guarantees a non-empty
  compiled prompt; the worker doesn't lint it or scan for prompt-injection
  payloads (see Security below).
- **No prompt-pinning guarantee.** A successful Voice Prototype run does
  *not* prove the same prompt will behave the same way once deployed to a
  worker profile — only that it sounds right when fed straight to the LLM.

### Contract (locked behind tests)

```jsonc
{
  "mode": "voice-prototype",
  "agentName": "<agent.slug>",
  "agent_id": "<agent uuid>",
  "session_id": "<session uuid>",
  "user_identifier": "<caller email>",
  "email": "<caller email>",
  "compiled_prompt": "<verbatim compiled instructions>"
}
```

Tests on both sides will fail if either side drifts:

- TS: `modelguide-api/tests/unit/agents/voice-prototype-dispatch.test.ts`
- Python: `examples/agents/livekit-agent/tests/test_prompt_agent.py`

The Python side rejects `mode != "voice-prototype"` so a stray voice-test
dispatch (without `compiled_prompt`) can never accidentally land in the
prototype worker.

### Endpoint shape

`POST /agents/:id/voice-prototype-token` — same error taxonomy as voice-test
plus one more 400:

| Status | Condition |
|---|---|
| 400 | Agent not active; modality ≠ voice; platform ≠ livekit; LiveKit URL/credentials missing; **no compiled prompt** |
| 401 | unauthenticated |
| 403 | authenticated but lacks `agents:activate` |
| 404 | agent doesn't exist (or in a different org) |
| 500 | LiveKit dispatch or token mint failed (session rolled to `abandoned`) |

### Security

- AccessToken is room-scoped and short-lived, identical to voice-test.
- LiveKit dispatch metadata travels over LiveKit's signaling channel,
  which is TLS-encrypted between the API and LiveKit Cloud. The prompt is
  not logged at INFO; only the character count is.
- **Prompt sourcing.** The compiled prompt comes from `agents.compiledInstructions`,
  written by the platform's compiler (`compiler.service.ts`). The compiler
  is the only writer in the data flow, which means a malicious admin can
  only inject content that already passes the compiler's input validation
  (SOP + guardrail steps), not arbitrary strings.
- **Prototype workers should run on the same trust boundary as production
  workers.** The metadata payload is treated as authenticated by virtue
  of the LiveKit signing secret; if a prototype worker is exposed to a
  LiveKit project that other tenants can dispatch to, an attacker could
  craft a prompt. Mitigation: deploy the prototype worker in the same
  LiveKit project the API uses for that org, never a shared one.

## Alternatives Considered

**Wedge the prompt into the existing voice-test endpoint behind a feature
flag.** Rejected — it would dilute ADR-014's "production parity" promise.
A flag is also one more thing for a future operator to misread as
"prototypes are the default now."

**Push the compiled prompt to the worker out-of-band (S3 / DB) and have it
poll.** Rejected for a prototype. Polling adds infra for a flow that
already has a perfectly good metadata channel; the per-dispatch overhead
of an extra HTTP fetch is wasted when the data is right there in
`ctx.job.metadata`. Worth revisiting if the prompt outgrows the safe
metadata envelope size (LiveKit's documented cap is well above typical
prompt sizes today).

**Reuse `BuildProAgent` with an override.** Rejected — `BuildProAgent`
hard-codes 11 tools and several scenario-specific hooks (cart-id injection,
reorder guardrails). Smuggling a different prompt in keeps the wrong-tools
problem. `PromptAgent` is intentionally tool-less to make the prototype's
scope obvious.

**Skip the ADR and do it inline.** Rejected — ADR-014 explicitly debates
this exact trade-off and lands on "no prompt injection." Reintroducing it
without an ADR would look like an oversight; with an ADR it's a documented
deviation scoped to a separate code path.

## Consequences

- Two voice paths to keep in sync. Adding a feature to `<VoiceTestPanel>`
  (e.g. the equalizer landed in PR #242) now means asking "should this
  also land on `<VoicePrototypePanel>`?". They share `RoomController` to
  cap how much code can diverge; UI polish that lives in `RoomController`
  is automatic for the prototype.
- The MG-agent-slug → worker-profile-slug contract is still load-bearing
  for voice-test but doesn't apply to voice-prototype, where the worker
  is `voice-prototype` for *every* agent. Operators reading dispatch logs
  should expect to see both worker names.
- "Compile prompt → Talk to prototype" is now the documented prompt
  iteration loop for LiveKit, matching the ElevenLabs `sync` flow's
  spirit. The "Talk to agent" button is still the answer to "does it work
  in prod".
- The prototype worker is a separate process (separate Railway service is
  the cleanest deploy shape). One image, two entrypoints — see
  `PROMPT_AGENT.md`.

## Known gaps

- The happy path (dispatch + token mint + 201) still has no end-to-end
  integration test for the same reasons enumerated in ADR-014 (no LiveKit
  in CI). What's covered: contract-shape unit tests on both sides + the
  same error-path integration coverage that exists for voice-test.
- The prototype worker doesn't yet wire MCP tools. A SOP that's
  declarative-prompt-only will sound right; a SOP that depends on tool
  side effects will read as "the LLM tried to make up an answer." This is
  by design for v1 but is the most likely next iteration.

## Related

- ADR-011: LiveKit Outbound Calls — the existing dispatch pattern.
- ADR-014: Browser Voice Testing — the production "Talk to agent" flow this
  intentionally diverges from.
- `examples/agents/livekit-agent/PROMPT_AGENT.md` — how-to.
- `modelguide-api/src/features/agents/agents.service.ts` —
  `createVoicePrototypeSession` and `buildVoicePrototypeDispatchMetadata`.
