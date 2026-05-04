# ADR-015: Voice-Test Prompt Override via Dispatch Metadata

**Status:** Accepted — supersedes the "No prompt injection" subsection of ADR-014.

## Context

ADR-014 introduced one-click browser voice testing. It deliberately omitted prompt injection — operators who edited a prompt had to redeploy the worker before they could hear the change. The trade-off was justified at the time: prevent "works in voice-test, broke in prod" drift.

In practice the lack of a tight feedback loop is now the bottleneck during prompt iteration. Operators routinely cycle:

1. Edit persona / language / filler phrases in the dashboard
2. Click **Compile prompt** — the result is stored in `agents.compiled_instructions`
3. Click **Talk to agent** — the call uses the worker's _baked_ prompt, not what was just compiled
4. Add a print-debug or tweak via a re-deploy and start over

Compile-step #2 is currently a side-effect with no observable outcome unless the operator opens the LLM evals separately. Voice-testing "what I just compiled" is the obvious next step and is a feature operators expect by analogy with ElevenLabs' web playground (which talks to the published agent at the moment of click).

The earlier rejection (PRs #234, #239) bounced for two reasons: (a) the prompt was deeply mutable across the call, and (b) the dispatch path needed byte-size guards. The current `agents.compiled_instructions` is a fixed snapshot owned by the API and the dispatch payload is small enough to stay under LiveKit's metadata cap with one mid-size guard. The 2024 reasons no longer apply.

## Decision

When an admin clicks **Talk to agent**, the API attaches the agent's latest `compiled_instructions` to the LiveKit dispatch metadata as `compiledInstructions`. The worker reads it on entrypoint and uses it as the system prompt for that single session. If the field is absent, empty, or non-string, the worker falls back to the baked profile prompt.

### Producer (`modelguide-api`)

`buildVoiceTestDispatchMetadata` (`src/features/agents/agents.service.ts`) adds an optional `compiledInstructions` field to the metadata object:

```ts
{
  mode: "voice-test",
  agentName: agent.slug,
  session_id: session.id,
  user_identifier: caller.email,
  email: caller.email,
  compiledInstructions?: string,    // NEW — only when ≤ cap and non-empty
}
```

The field is **omitted** (not blank-stringed) when:

- The agent has no compiled prompt yet (`compiled_instructions IS NULL`)
- The compiled prompt is empty
- The compiled prompt exceeds `COMPILED_INSTRUCTIONS_MAX_CHARS = 50_000`

**Rationale for "drop, don't truncate":** a half-prompt that "still works" produces wrong-but-plausible behavior — far harder to triage than the agent visibly running on its baked profile prompt with a UI hint. The cap is sized to leave room for the rest of the dispatch metadata under LiveKit's effective ~100 KB metadata budget.

### Consumer (`examples/agents/livekit-agent`)

`prompt_override.resolve_instructions(dispatch_metadata, baked_prompt)` is the single decision point. It returns the override iff the value is a non-empty, non-whitespace string. Anything else falls through to the baked prompt.

`agent.py` calls it after parsing `ctx.job.metadata` and before constructing the agent. `BuildProAgent` accepts an optional `instructions_override` constructor parameter so subclasses inherit the behavior automatically — `MCPAgent` is the place to thread the override if more agent classes are added.

A debug log line fires whenever the override is applied so production traces show "this session ran on a freshly compiled prompt, not the deploy artifact." Without it, a misbehaving voice-test would be indistinguishable from a misbehaving production session in logs.

### UI (`modelguide-ui`)

`VoiceTestPanel` renders a `PromptSourceHint` block under the description. With a compiled prompt, it shows "Using the compiled prompt (compiled 5m ago)." Without one, it shows "No compiled prompt yet — the worker will use its baked profile default." The dashboard never lets the operator believe they're testing something they aren't.

### What this contract pins

The producer and consumer have no shared type system. Two test files are the contract:

- `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts` — the API emits the right field name, drops over-cap prompts, omits null/empty.
- `examples/agents/livekit-agent/tests/test_dispatch_prompt.py` — the worker reads the right field name, falls back on empty/whitespace/non-string, preserves the override content verbatim.

A drift in either side fails its test in CI.

## Consequences

- **Tight prompt iteration loop.** Compile → click → talk in <5 seconds. The whole reason this ADR exists.
- **The MG agent's `compiled_instructions` is now a runtime input to the worker**, not just an evals input. Any code path that writes `compiled_instructions` immediately changes voice-test behavior. The compile pipeline is the only such writer today; if a future feature adds another (e.g. SOP draft preview), it must respect the same shape.
- **Drift between voice-test and production** is now possible: a voice-test runs with the latest compiled prompt; a production call runs with whatever the worker was deployed with. The UI hint is the mitigation. A future hardening step is to cut a "deploy compiled prompt" button that ships the same payload to the worker's profile registry.
- **The byte cap (50K chars) is load-bearing.** Compiled prompts above the cap silently fall back to the baked prompt — but the UI hint still says "Using compiled prompt." This is a known gap; if we see prompts approaching the cap in practice we should surface the truncation in the UI. Out of scope for this POC.
- **`MCPAgent` does not yet thread `instructions_override`.** Only `BuildProAgent` honors it. New agent subclasses must accept the same parameter and pass it to the appropriate `super().__init__(instructions=...)` call. A follow-up should pull the override into `MCPAgent` itself so this isn't a per-subclass concern.
- **The closed PRs #234 / #239 are the prior art.** Their rejection was correct under ADR-014's scope; this ADR re-opens the question with a narrower payload (single fixed field, single path through the worker) and explicit drop-on-cap semantics.

## Alternatives Considered

**Add a REST endpoint `GET /api/agents/me/prompt` and have the worker fetch on connect.**
Rejected — adds a round-trip to a hot path for no upside. The dispatch metadata channel is already serialized and signed; using it for the prompt is one less moving piece. We'd revisit this if the prompt outgrew the metadata cap, or if we wanted prompt rotation mid-session (we don't).

**Mid-session prompt updates (LiveKit `agent.update_instructions`).**
Out of scope. We don't have a UI for it, and operators iterate by hanging up + redialing. If a use case appears (e.g. mid-call SOP escalation), revisit.

**Ship the compiled prompt to the worker's profile registry as a deploy artifact.**
Future hardening, not a substitute. The dispatch-metadata path is "test the prompt right now"; the registry path is "deploy the prompt." Both will eventually exist.

**Truncate over-cap prompts to fit the metadata budget.**
Rejected — see above. A truncated prompt produces plausible-but-wrong behavior; a dropped prompt gracefully degrades to baked.

## Related

- ADR-011 — LiveKit Outbound Calls — the dispatch + token pattern this builds on.
- ADR-014 — Browser Voice Testing — introduced the voice-test endpoint; this ADR supersedes its "No prompt injection" subsection.
- `examples/agents/livekit-agent/README.md` — section "Voice-test prompt override" documents the worker-side contract.
