## ADR-015: Voice-Test Prompt Injection (POC)

**Status:** Accepted (POC — scoped alongside ADR-014, not superseding it)

## Context

ADR-014 shipped one-click browser voice testing against the deployed LiveKit
worker and **deliberately** rejected carrying a prompt override in dispatch
metadata. The rationale was that the worker's profile is the authoritative
source of the prompt; injecting a different prompt creates a "it works in
voice-test but broke in prod" drift, and the metadata byte-size accounting
added ~100 lines of guards for a feature that could be avoided by just
redeploying the worker.

Two things have shifted since then:

1. **Prompt compilation is the dominant iteration loop.** Admins edit SOPs /
   persona / guardrails, click Compile, and want to hear the result
   immediately. Between "click Compile" and "hear the new voice" there is
   currently a 5–15 minute Docker build + LiveKit Cloud redeploy — fine for
   promotion, fatal for iteration. The voiceblox UX (which this POC takes
   direct inspiration from) demonstrates that "edit → sync → talk" is the
   loop admins expect.
2. **ElevenLabs agents already do this.** The ElevenLabs sync path
   (`agents.sync.ts`) pushes `agent.compiledInstructions` into the
   ElevenLabs agent config at sync time, so testing an ElevenLabs agent
   already picks up the freshly compiled prompt. LiveKit agents are the
   outlier — the asymmetry is confusing and costs us iteration speed.

We still agree with ADR-014's concerns, so the POC is scoped narrowly rather
than replacing the prod path.

## Decision

Add a **second**, parallel voice-test endpoint dedicated to prompt-override
testing. The prod path from ADR-014 is untouched.

### API surface

`POST /agents/:id/voice-test-poc-token` — permission `agents:activate`.

On success it:

1. Validates the agent is LiveKit-platform, voice modality, active, and has
   a non-null `compiledInstructions` (400 if not — we do not dispatch with
   an empty override; silent-fallback would be the scariest failure).
2. Creates a ModelGuide session with `userMetadata.voiceTestPoc: true` so
   the transcript and analytics can distinguish POC sessions from prod
   voice tests post-hoc.
3. Builds dispatch metadata via `buildVoiceTestPocDispatchMetadata`
   (pure, unit-tested) which produces:

   ```json
   {
     "mode": "voice-test-poc",
     "agentName": "<agent.slug>",
     "session_id": "<uuid>",
     "user_identifier": "<caller email>",
     "email": "<caller email>",
     "compiled_instructions": "<agent.compiledInstructions>"
   }
   ```

4. Dispatches the worker into a `voice-test-poc-<nanoid>` room (distinct
   prefix from prod voice-test rooms so log greps can scope to one or the
   other).
5. Mints the same short-lived AccessToken as the prod path.
6. Returns the same shape as `/voice-test-token` — the UI is identical
   downstream of token receipt.

### Worker contract

The LiveKit worker (`examples/agents/livekit-agent`) reads
`dispatch_metadata["mode"]` via the new pure helper
`resolve_instructions(metadata, default)` in `src/voice_test_poc.py`:

- If `mode == "voice-test-poc"` **and** `compiled_instructions` is a
  non-empty string → return it (override the baked prompt).
- In every other case (prod `voice-test`, outbound SIP, legacy
  dispatches with no mode, blank override, wrong type) → return the baked
  default. This function is covered by 10 unit tests in
  `tests/test_voice_test_poc.py`.

The agent constructor (`BuildProAgent.__init__`) now accepts
`instructions_override`. When present, it's used verbatim — the local
`build_system_prompt(...)` interpolation is skipped because the API-side
compiler has already done that work.

### Guards (answering ADR-014's objections)

- **Byte-size cap.** `VOICE_TEST_POC_MAX_PROMPT_BYTES = 32 KB` (UTF-8
  byte length, not JS char length — 4-byte emoji would otherwise sneak
  past a char-length check and get truncated on the wire). LiveKit's
  dispatch metadata ceiling is ~48 KB total; 32 KB leaves headroom for
  the rest of the JSON envelope plus LiveKit's framing. Overflow → 400
  at request time, before dispatch.
- **Distinct mode marker.** The prod and POC paths never share
  `mode` values, never share room prefixes, and never share dispatch-helper
  code. A refactor on one can't accidentally leak into the other.
- **Empty / whitespace prompt rejected at the source.** The builder
  throws; the worker-side resolver also refuses blank overrides and
  falls back. The failure mode of "admin thinks they're testing the
  new prompt, worker is running the old one" requires **two** guards
  to fail silently at once.
- **The prod voice-test path still exists**, unchanged. Teams who want
  ADR-014's guarantees (test what prod runs) keep clicking "Talk to
  agent"; teams iterating on prompts click "Sync & Test".

### UI

`VoiceTestPanel` now renders two buttons:

- **Talk to agent** — unchanged (ADR-014 path).
- **Sync & Test** — disabled when `compiledInstructions` is null; otherwise
  hits `/voice-test-poc-token`. The tooltip tells the operator to click
  Compile first when disabled.

Both land in the same `WidgetState` machine — only the endpoint path
differs.

### What this deliberately does NOT do

- **No automatic recompile before dispatch.** The button assumes the
  admin has already clicked Compile (or recently edited the SOP and
  accepted the recompile prompt). Chaining compile→dispatch from a
  single click is follow-up work — the current flow is explicit about
  "you are about to test the most-recently-compiled prompt".
- **No streaming prompt updates mid-call.** The prompt is set at
  `Agent(instructions=...)` construction time. Changing it mid-session
  would require LLM re-initialization that LiveKit Agents 1.4 doesn't
  expose cleanly.
- **No prompt storage separate from `agent.compiledInstructions`.** The
  POC uses whatever the compiler last persisted; if you want to try
  *multiple* prompt variants in quick succession, commit each one via
  Compile first. A transient "draft prompt" slot is a feature for a
  follow-up ADR if the pattern takes hold.

## Alternatives Considered

**Push the compiled prompt to the worker via a side-channel (HTTP) before
dispatch.** Rejected — requires the worker to expose a mutation endpoint,
ACL that endpoint, reconcile concurrency ("two admins syncing at once"),
and handle "worker rolled to a new pod mid-test". Dispatch metadata is a
single immutable unit of work scoped to one room, so there's no
concurrency model to invent.

**Store drafts in a new `agent_draft_prompts` table and dispatch by
draft ID.** Rejected for the POC — adds a migration and a new feature
surface for zero observable win over "use the compiled field directly".
Revisit if the POC graduates into a real "A/B prompt testing" feature.

**Fold the POC behaviour into the existing `/voice-test-token` behind
a `?usePrompt=compiled` query flag.** Rejected — the whole point of
ADR-014 was that `/voice-test-token` is the "test what prod runs" path.
Overloading it with an injection mode erodes that guarantee. Two
routes, two behaviours, one can never be mistaken for the other.

**Client-side prompt replacement (strip baked prompt, swap with compiled
before `Agent.start`).** That *is* what the worker does internally — but
the trigger has to come from somewhere, and dispatch metadata is the only
signal the worker sees before it boots. So we're back to "put it in the
metadata".

## Consequences

- Admins can iterate on prompts without a Docker rebuild — the main
  motivation.
- The voice-test panel has two buttons; UX complexity increases slightly.
  Mitigated by the tooltip on the disabled state.
- `VOICE_TEST_POC_MAX_PROMPT_BYTES = 32 KB` is a cliff that real prompts
  could hit as SOPs accumulate. Compiler warnings already surface token
  counts; we can add a byte-size hint there in a follow-up.
- POC sessions are tagged in `userMetadata` (`voiceTestPoc: true`) and
  use `voice-test-poc-` room prefix, so analytics can split metrics by
  path if we want to see "how often are admins using Sync & Test vs the
  prod button".
- The worker now has one additional import and one pure-function call
  per dispatch — negligible cost, and the behaviour is a no-op for every
  non-POC dispatch.

## Known test gap (carried over from ADR-014)

Happy-path end-to-end — the real dispatch landing in the worker and the
worker actually using the override — still requires a live LiveKit server,
which CI doesn't have. What we cover instead:

- **API side:** `buildVoiceTestPocDispatchMetadata` is pure and covered
  by 11 unit tests (shape, mode marker, byte-size cap, UTF-8 multibyte
  safety, empty rejection, JSON round-trip, slug verbatim). The route
  has 8 integration tests covering every error path (auth, RLS,
  non-LiveKit, non-voice, inactive, missing compiled prompt, missing
  LiveKit config).
- **Worker side:** `resolve_instructions` is pure and covered by 10
  unit tests — the 5 failure modes (missing, blank, wrong-type, wrong
  mode, non-dict metadata) all fall back to the baked default.
- **UI side:** The existing `voice-test-panel.test.tsx` gains 3 new
  tests: button disabled without `compiledInstructions`, enabled with
  it, and dispatches to the POC endpoint on click.

The one drift that **would** survive this test matrix is a contract
mismatch between the API builder and the worker resolver — if someone
renames `compiled_instructions` to `compiledInstructions` on the API side
but not the worker side, every POC dispatch silently falls back to the
baked prompt and CI passes. Mitigation: the integration test asserts
the exact JSON key name on the API side, and the worker unit test asserts
it on the worker side — the pair is a grep-compatible contract even
though there's no shared type.

## Related

- ADR-011: LiveKit Outbound Calls — the original dispatch + token pattern.
- ADR-014: Browser Voice Testing — the prod voice-test path this POC
  runs alongside. Explicitly rejected prompt injection; this ADR
  revisits that decision for an opt-in, narrow, distinctly-marked path.
- Voiceblox (<https://github.com/voiceblox-ai/voiceblox>) — UX
  inspiration for the edit → sync → talk loop.
