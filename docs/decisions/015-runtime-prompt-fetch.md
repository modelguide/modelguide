# ADR-015: Runtime Prompt Fetch for Prototype Voice Agents

**Status:** Accepted

## Context

The dashboard already gives operators a fast loop for editing what an agent says:

1. Edit a SOP.
2. Compile it on the agent detail page (`POST /api/agents/:id/compile`).
3. Click **Talk to agent** (ADR-014).
4. Hear the change.

In practice, step 4 fails the promise of step 3 for our production-style LiveKit agent (`examples/agents/livekit-agent`): that agent's prompt is **baked into the worker image** (`src/prompts/base.py` + `src/prompts/workflows/`). To make a compile-time prompt change land in a voice test, an operator has to rebuild and redeploy the worker — minutes of CI per iteration, not the seconds the "Talk to agent" button implies.

ADR-014 explicitly punted on closing that gap: it rejected runtime prompt injection from the API into worker dispatch metadata because doing so would "create a 'it works in voice-test but broke in prod' failure mode" — the worker's baked profile is the authoritative source of truth.

That tradeoff is right for the production agent — but it leaves a hole for the **prototyping** use case, where the whole point is to iterate on a prompt before committing it to a worker profile.

## Decision

Introduce a second, simpler reference agent (`examples/agents/voiceblox-agent`) whose architectural premise is the inverse:

> **The compiled prompt in ModelGuide IS the authoritative source. The worker has no prompt of its own.**

To support that, add one read-only API endpoint:

```http
GET /api/agents/me/runtime
Authorization: Bearer mgk_...
```

returning the agent's identity + the latest compiled prompt:

```ts
{
  id: string                     // agent UUID
  name: string
  slug: string
  modality: "voice" | "text"
  modelFamily: "gpt" | "claude" | "gemini" | "generic"
  agentPlatform: "custom" | "elevenlabs" | "livekit"
  isActive: boolean
  promptConfig: PromptConfig     // persona, fillerPhrases, language
  compiledInstructions: string | null
  compiledAt: string | null      // ISO 8601
}
```

The prototype agent calls this on every `entrypoint()` and passes the returned `compiledInstructions` straight to `Agent(instructions=...)`. No prompt is baked into the worker image; no prompt is injected via dispatch metadata; nothing flows browser → API → dispatch metadata. The runtime is a "fetch and speak" loop, period.

### Why a new endpoint instead of `GET /api/agents/:id`

* **Auth model.** `GET /:id` is JWT-only (`requireUser`). The runtime has no user JWT and shouldn't have one. It uses its own `mgk_` API key. `requireAgent()` enforces that, and the implementation reads `getCurrentAgent(c).id` so the agent never needs to pass its own id in the URL (and can't spoof another agent's).
* **Payload shape.** `GET /:id` returns secret refs, integration URLs, key-prefix indicators, eval-suite counts — all dashboard concerns. The runtime payload is narrowed to the four things a voice runtime needs: identity, modality, prompt, voice config. Less surface area, less risk of accidentally leaking a secret ref into a worker log.
* **Stable contract.** A future change to the dashboard schema (more counters, more derived fields) shouldn't ripple through deployed prototype agents. The runtime endpoint is the lock.

### Why a second agent instead of changing `livekit-agent`

ADR-014's reasoning still holds for the production agent. Two specific failure modes drove that decision and would resurface if we retro-fitted runtime prompt fetch onto `livekit-agent`:

1. **Compile-time tool-prompt consistency.** Production prompts are composed with workflow files that reference specific `@function_tool` decorators in the worker. A compiled prompt that names a tool the worker doesn't define would silently no-op at runtime. The baked-in setup catches this at deploy time.
2. **Tracing / version pinning.** `livekit-agent`'s Langfuse traces carry the worker version. If the prompt is also fetched live, a trace from yesterday can't be reproduced — the prompt has moved. That breaks regression triage.

Both concerns are *non-issues* for the prototype agent, which doesn't expose tools and isn't pinned by version. Keeping the two agents separate preserves both intents without one constraining the other.

### Alternatives considered

**Embed the compiled prompt in dispatch metadata.** Rejected — same reasoning as ADR-014 ("No prompt injection"). Dispatch metadata is bounded (~48 KB) so we'd have to add a length guard; prompt size would couple to LiveKit's metadata limits; and `instructions_override` patterns failed in earlier iterations (#234, #239).

**Push compiled prompts to workers via webhook.** Rejected — webhook delivery for a prompt update would race a concurrent dispatch, leaving a window where new calls join a worker that still has the old prompt. Pull-on-session-start has no such window: each session reads the canonical store, period.

**Cache the prompt in the worker with TTL.** Rejected for now — premature optimization. A compiled prompt is a few KB; the fetch is a single GET against an org-RLS-scoped DB row; the round-trip is well under the time the worker spends bringing up STT/TTS streams. Revisit only if profiling identifies it as the hot path.

**Make the new endpoint accept arbitrary `agentId` from the URL.** Rejected — derive it from the API key instead. Lets the operator reuse one URL across all their voice prototypes; closes off a confused-deputy class where someone with a valid `mgk_` key could read another org's compiled prompt by guessing IDs.

## Security

* `GET /api/agents/me/runtime` is protected by `requireAgent()` middleware. Only an `mgk_` API key bound to an agent gets in. User JWTs are rejected (verified by `agent-runtime.test.ts`).
* The payload deliberately omits everything sensitive: no secret refs, no integration URLs, no platform credentials, no webhook secret indicators, no key prefixes. A leaked worker log is contained to the system prompt + identity.
* The compiled prompt itself is treated as semi-sensitive (it can contain SOP details, tool docs, customer scripts). The worker process should ensure logs strip the prompt before shipping; `voiceblox-agent` does not log its instructions at INFO level.

## Consequences

**Positive**

* Operators get the loop the **Talk to agent** button has always *implied*: edit SOP → compile → talk → hear the new behaviour, in seconds. No CI, no redeploy.
* The new agent's deployment story is "one Docker image per ModelGuide agent" — straightforward, easy to copy. New prototypes don't have to learn the multi-profile registry pattern.
* The runtime endpoint is a clean integration point for future non-LiveKit voice runtimes (Pipecat, etc.). They'll all be able to ship without their own bespoke "how do I get my prompt" path.

**Negative / accepted**

* Adds a per-session network hop. Quantified: ~30 ms p50 against a regional API. Acceptable inside a budget that's already dominated by STT/TTS warmup.
* Two reference agents to keep in sync conceptually. Mitigation: the README of each cross-links to the other and to this ADR, so a new contributor sees both at once. The two are *not* expected to share code — they're load-bearing on different axes.
* If a prototype is promoted to production with the runtime-fetch model intact, it inherits the failure modes ADR-014 warned about. Mitigation: the prototype's README documents this as **deliberate** and tells the reader where to migrate (`../livekit-agent`) when they outgrow it.

**Known test gap**

The full end-to-end loop (compile in dashboard → fetch in agent → speak with new prompt) is not covered by automated CI — it would require a real LiveKit server, a deployed agent, and audio capture, which is well outside the test harness today. Two narrower tests carry the contract:

* `tests/integration/agent-runtime.test.ts` (modelguide-api) — locks the response shape and auth model: 200 + payload for a valid `mgk_` key, 401 for no auth, 401 for a user JWT, null fields for an un-compiled agent, no secret leakage.
* `examples/agents/voiceblox-agent/tests/test_mg_client.py` — locks the *Python* side of the same contract: `RuntimePayload.from_json` accepts every shape the API can return.

If these two tests stay green, the field names match end-to-end and a manual voice test stays the right way to verify behaviour.

## Related

* **ADR-014** — Browser Voice Testing: introduces the dispatch + token + `<LiveKitRoom>` pattern this builds on. We extend the dashboard-side workflow, not replace it.
* **ADR-011** — LiveKit Outbound Calls: shares `dispatchAgentToRoom`. Unaffected.
* **ADR-005** — SOPs as Core Primitive: the compiled prompt this endpoint returns is the output of the SOP compiler.
