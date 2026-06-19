# ADR-015: Prototype Voice Test with Inline Prompt Override

**Status:** Accepted

## Context

ADR-014 ships browser voice testing for LiveKit agents — admin clicks "Talk to agent" and the API dispatches the deployed worker with the agent's slug, so a multi-profile worker picks the right profile. That ADR **deliberately rejects** putting the agent's compiled prompt in dispatch metadata, on the grounds that a `prompt_override` field creates a "works in voice-test, breaks in production" failure mode.

That trade-off makes sense for the production path. It fails the prompt-iteration loop, though.

Prompt iteration looks like this:

1. Edit an SOP step or knowledge entry.
2. Click **Compile** — the compiler emits a new system prompt and writes it to `agents.compiledInstructions`.
3. Want to hear how it sounds.

Today, step 3 requires **rebuilding the LiveKit worker image with the new prompt baked into its profile and redeploying it.** That is a 5–10 minute round-trip — for a copy change you might want to revert in 30 seconds. The friction discourages iteration; admins ship prompts they haven't tested.

A separate workflow inspired by [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox) closes this loop: a dedicated **prototype worker** that takes its system prompt from dispatch metadata at room-join time. Compile → click → talk in 5 seconds.

## Decision

Ship a **second LiveKit worker** alongside the production one, plus an API endpoint and dashboard control to drive it.

### New worker

`examples/agents/livekit-prototype/` — minimal LiveKit agent:

- Reads system prompt from dispatch metadata (`instructions` field).
- **No MCP, no tool registry, no SOP execution, no session-completion callbacks.** It runs STT → LLM → TTS with the dispatched prompt, full stop.
- Rejects dispatches whose `mode` is anything other than `prototype` — so production traffic cannot accidentally route here.
- Same Dockerfile layout / deployment workflow as the production worker; deploys to LiveKit Cloud independently.

### New API endpoint

`POST /api/agents/:id/prototype-voice-test-token` — mirrors `voice-test-token` (ADR-014) but:

- **Requires `agents.compiledInstructions` to be populated** (400 otherwise).
- Caps the compiled prompt at `MAX_PROTOTYPE_INSTRUCTIONS_LENGTH = 50_000` chars to stay within LiveKit's ~48 KB dispatch-metadata budget. Most compiled prompts are <10 KB.
- Dispatches with metadata mode `prototype` and an extra `instructions` field carrying the compiled prompt verbatim.
- Uses room prefix `prototype-<nanoid>` (vs. `voice-test-<nanoid>`) so logs and dashboards can distinguish flows at a glance.
- Returns the same shape as `voice-test-token` plus a `promptLength` field for the UI to surface.

### Dispatch contract

The shape is locked behind paired tests on both sides — same pattern as ADR-014:

| Side | Test |
|---|---|
| API | `modelguide-api/tests/unit/agents/prototype-voice-test-dispatch.test.ts` |
| Worker | `examples/agents/livekit-prototype/tests/test_dispatch.py` |

```ts
{
  mode: "prototype",
  agentName: "<agent slug>",
  session_id: "<MG session id>",
  user_identifier: "<caller email>",
  email: "<caller email>",
  instructions: "<compiled system prompt, verbatim>"
}
```

### Dashboard

Voice Test panel grows a second button — **"Test latest prompt"** — sitting next to **"Talk to agent"**. The first hits the new endpoint and dispatches the prototype worker with the freshly compiled prompt. The second remains the production path. Each button has its own disabled-state copy when its preconditions aren't met (no LiveKit config, no compiled prompt).

## What this deliberately does NOT do

- **Doesn't change `/voice-test-token` or the production worker.** ADR-014 stays in force for live traffic.
- **Doesn't share a worker process between the two modes.** The prototype worker `return`s on `mode != "prototype"` — keeping them as two different binaries is the safety boundary that prevents inline-prompt overrides from leaking into production.
- **Doesn't ship a "save as new profile" affordance.** The prototype loop is for iteration only; promoting a tested prompt to production still means rebuilding the production worker image, the same gate ADR-014 protected.
- **Doesn't expose the compiled prompt to the browser.** The endpoint reads `compiledInstructions` server-side from `agents` and only the LiveKit worker ever sees it in the dispatch payload — never returned to the client.

## Alternatives Considered

**Flip ADR-014 — add `instructions_override` to the production `voice-test-token`.** Rejected, again. The drift-in-testing risk is real, and the bytes-on-the-wire guards (size caps, dispatch-metadata budget) clutter the production hot path for a workflow only used during authoring. Keeping prototype as a separate worker contains the blast radius.

**Run the prototype worker on the same LiveKit project as the production worker (different agent name).** Workable, but operationally fragile: two worker IDs in one project mean an admin can accidentally point `metadata.livekit.agentName` at the prototype binary and serve prototype-mode traffic to customers. Deploying to a sibling LiveKit Cloud project is cheap and removes the foot-gun.

**Stream the prompt over a side-channel instead of dispatch metadata** (e.g. push it via room data after the participant connects). Rejected — adds a second async dependency the room start now waits on, and the metadata channel already carries everything it needs. JSON-encoded 10 KB prompts are well inside the budget.

**Skip compile gating — let admins try any draft prompt.** Rejected — the compile step is also where guardrails and knowledge entries get folded in. Bypassing it means the prototype loop tests a different prompt than what would actually deploy. The 50K char cap is enforced *after* compile, so legitimate prompts always fit.

## Consequences

- **5-second compile-and-talk loop.** Admins can iterate prompt copy without a worker redeploy.
- **Two LiveKit workers to operate.** Both need their own deploy lane, env vars, and runbook. Mitigated by giving the prototype worker its own directory with parallel structure (Dockerfile, README, .env.example) and refusing to share env.
- **A "tested in prototype, behaves differently in production" gap remains** — but it's a known boundary now, signposted by the worker name and the room prefix in logs. Promoting a prompt still means a production redeploy with the same baked-in profile.
- **The dispatch contract is now load-bearing in two places** (production and prototype). Both sides have unit-test guards. A future refactor that changes one without the other will fail CI on the side that drifted.
- **Cost is bounded.** The 50K cap + the JSON envelope keeps each dispatch under ~52 KB, well inside LiveKit's metadata budget. There is no recurring cost beyond what the production voice-test path already pays.

## Known test gap

Same as ADR-014's: the happy path (dispatch + token mint + 201 response) has no end-to-end integration test because dispatching against a real LiveKit server is out of scope for CI. What's covered:

- The pure dispatch helper (`buildPrototypeDispatchMetadata`) has full unit coverage.
- The worker-side parser (`parse_prototype_dispatch`) has full unit coverage, including rejection of the production `mode = "voice-test"` value.
- Both sides assert the same field names — if either drifts, the parser fails CI loudly.

Net risk: a refactor that reorders orchestration inside `createPrototypeVoiceTestSession` (token before dispatch, etc.) could pass CI. Follow-up: same hardening path as ADR-014 — DI layer or a LiveKit test server in CI.

## Related

- ADR-011: LiveKit Outbound Calls — origin of the dispatch + token pattern.
- ADR-014: Browser Voice Testing — explicitly rejects this for the production path; this ADR carves out the prototype lane.
- `examples/agents/livekit-prototype/` — the new worker.
- `examples/agents/livekit-agent/` — the production worker, untouched.
- Inspiration: [voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox).
