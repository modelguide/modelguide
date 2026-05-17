# ADR-015: LiveKit Voice-Test — Compiled-Prompt Sync via Dispatch Metadata

**Status:** Accepted

**Supersedes:** ADR-014, "What this deliberately does NOT do" → first bullet ("No prompt injection")

## Context

ADR-014 shipped `POST /api/agents/:id/voice-test-token` — one-click "Talk to agent" from the dashboard. Its explicit non-goal was prompt injection: the worker's profile (baked into the worker image at deploy time) was treated as the sole source of truth for the system prompt. The motivating concern was a "works in voice-test, breaks in prod" drift between the prompt being tested and the prompt actually shipping.

In the seven months since, ModelGuide's centre of gravity has shifted:

- **Prompts are now compiled from SOPs.** `POST /api/agents/:agentId/compile` (ADR-005, ADR-009) turns a SOP definition + guardrails into a system prompt, persisted to `agents.compiled_instructions`. The worker's hardcoded BuildPro template (`examples/agents/livekit-agent/src/prompts/base.py`) is increasingly a reference implementation, not the production prompt.
- **The intended workflow is iterative.** An operator opens the agent detail page, edits an SOP, hits Compile, hits Talk-to-agent, hears the result, edits again. Forcing a worker redeploy in that loop turns a 5-second iteration into a 5-minute one and pushes operators back to the LLM-only sandbox where they can't exercise the same voice + TTS + MCP-tool surface as production.
- **The "drift" failure mode hasn't materialised.** Operators were always going to ship the prompt they tested; without a sync mechanism they were just shipping it slower. The actual failure mode we observed was the opposite — operators stopped using voice-test because the worker prompt didn't match what they'd just compiled, and reverted to mock chat sims that don't exercise STT/TTS at all.

A separate spike (referenced repo: github.com/voiceblox-ai/voiceblox) demonstrates the loop the prototype is targeting: compile → click sync/test → speak, with the same prompt visible in the dashboard and running on the dispatched worker.

## Decision

**The voice-test dispatch metadata now carries the agent's `compiled_instructions` (and `compiled_at` timestamp) when present.** The LiveKit worker, on receiving them, uses that prompt verbatim instead of its baked-in template.

### Wire format

`buildVoiceTestDispatchMetadata` in `modelguide-api/src/features/agents/agents.service.ts` produces:

```jsonc
{
  "mode": "voice-test",
  "agentName": "<agent.slug>",
  "session_id": "<sess_uuid>",
  "user_identifier": "<caller_email>",
  "email": "<caller_email>",
  // ADR-015 — present together or not at all:
  "compiled_instructions": "<full compiled prompt verbatim>",
  "compiled_at": "<ISO 8601 timestamp>"
}
```

Both compiled fields are **omitted** (not nulled) when the agent has never been compiled. This lets the worker do a flat `"compiled_instructions" in metadata` check and degrade gracefully.

### Worker behaviour

`examples/agents/livekit-agent/src/agent.py`:

```python
dispatch_metadata = parse_dispatch_metadata(ctx.job.metadata)
compiled_instructions = dispatch_metadata.get("compiled_instructions")
agent = BuildProAgent(
    session_id=session_id,
    user_email=user_identifier,
    mcp=mcp,
    instructions_override=compiled_instructions,
)
```

`BuildProAgent.__init__(..., instructions_override: str | None = None)`:

- Truthy override → use verbatim.
- Falsy override (None or `""`) → fall back to the legacy `build_system_prompt(session_id, user_email=user_email)` template. **No silent concat** — the override path and the template path are mutually exclusive.

### UI signalling

`VoiceTestPanel` (`modelguide-ui/src/features/agents/components/voice-test-panel.tsx`) now renders a status row above the Talk button:

- **Compiled →** green "Testing compiled prompt from `<relative time>`" badge.
- **Uncompiled →** muted "Uncompiled. No compiled prompt yet — the worker will use its baked-in profile" notice.

The operator always knows which prompt the call is about to run.

### Contract enforcement

Two pure-function test suites lock the contract:

- **TypeScript:** `modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts` — 10 tests covering omission semantics, verbatim echo, and the "both-or-neither" invariant on the two new fields.
- **Python:** `examples/agents/livekit-agent/tests/test_dispatch_metadata.py` — 10 tests covering JSON-parse robustness, override-takes-precedence, fallback-on-empty, and an end-to-end metadata-string → agent-instructions assertion.

Because there's no static type system bridging the two sides, the tests *are* the contract.

## Why this is safe (addressing ADR-014's concerns)

ADR-014 rejected this pattern on three grounds. Each is addressed by the current shape:

1. **"Works in voice-test, breaks in prod."**
   The compiled prompt comes from `agents.compiled_instructions`, which is the **same** field a downstream sync (`POST /agents/:id/sync` for ElevenLabs; analogous LiveKit reload is the natural next step) will read when shipping the prompt. Voice-test now exercises the production-bound artefact, not a side-channel snippet. The drift this ADR is actually most concerned about — prompt-tested-A, prompt-shipped-B — gets *smaller*, not larger.

2. **"Adds ~100 lines of byte-size guards."**
   The compiled prompt is already bounded by the compiler's token budget (see `compiler.service.ts` warnings on `systemPromptTokens` / `totalEstimatedTokens`). LiveKit's dispatch metadata limit is ~48 KB; a 32K-token compiled prompt is ~100 KB *worst case*, which is well outside what the compiler will emit. Rather than adding hard cap guards in two places, we lean on the upstream budget and add a single integration assertion if/when LiveKit ever 413s a dispatch. Net new validation code: 0 lines.

3. **"If you want to test a new prompt, redeploy."**
   This is the loop the prototype is explicitly trying to eliminate. The redeploy guidance still applies to *worker-level* changes (new tools, new providers, new VAD/turn-detector config) — those genuinely need a new container. Prompt-level changes do not.

## Alternatives Considered

**Worker fetches compiled prompt from `/api/agents/:id` on dispatch.**
Rejected for the prototype: introduces a new authenticated REST round-trip per call (added latency on the cold-start path), needs a worker-side cache invalidation story, and requires the worker to know its caller's API key. Metadata-piggyback is single-hop and reuses the existing dispatch path.

**Pass the compile request through `/voice-test-token` (compile-then-dispatch in one call).**
Rejected: couples two endpoints with very different failure modes (compile errors are 422s with structured warnings; dispatch errors are 5xxs with retryable-vs-not nuance). The dashboard already has a separate Compile dialog; chaining can be done client-side without coupling at the API boundary. Future work — see Consequences.

**Inject a *diff* against the worker's baked-in prompt.**
Rejected as the wrong unit: the dashboard shows full compiled prompts, not diffs, and the worker should run exactly what the dashboard shows.

## Consequences

- **Iteration loop is closed.** Compile → Talk → hear it → edit → repeat, with no worker redeploy in between.
- **Voice-test now exercises the production prompt path.** The drift surface between dashboard and worker shrinks for everything except worker-level config.
- **Worker images become thinner over time.** Their `prompts/` tree becomes a fallback used only when an agent has never been compiled (e.g. cold-start demos, smoke tests). New agents added through the dashboard will never load it.
- **Pending follow-up:** a "Compile & Talk" combined action in the prompt section that chains compile → poll → voice-test in one click. The plumbing is in place; the UX wiring is the smallest remaining step and would benefit from a usability pass before shipping.
- **Pending follow-up:** the metadata-size guard. We're betting the compiler's token budget bounds this; if a real call ever 413s, harden in `buildVoiceTestDispatchMetadata` rather than reverting this ADR.

## Related

- ADR-005: SOPs as a Core Primitive — origin of `compiled_instructions`.
- ADR-011: LiveKit Outbound Calls — the dispatch primitive this builds on.
- ADR-014: Browser Voice Testing — the endpoint this extends, and the "no prompt injection" section this ADR supersedes.
- Inspiration: github.com/voiceblox-ai/voiceblox (sync-and-talk loop pattern).
