# ADR-015: Voice-Test Preview With Draft Compiled Prompt

**Status:** Proposed (prototype)

## Context

ADR-014 shipped one-click browser voice testing (`POST /agents/:id/voice-test-token`) and deliberately rejected prompt injection via dispatch metadata. The reasoning was sound for production dispatch: if voice-test uses a different prompt than the deployed worker profile, you get a drift-in-testing failure mode where "it works in voice-test but broke in prod."

Since then, prompt iteration has become the bottleneck:

- A prompt author compiles a SOP into a system prompt (`POST /agents/:id/compile` — see `compiler/`).
- To actually hear how it sounds, they have to rebuild the worker image with the new prompt baked in, push it to LiveKit Cloud, wait for the rollout, and then click "Talk to agent."
- Round-trip time: minutes, not seconds. Every tweak costs a redeploy.

The voiceblox pattern (https://github.com/voiceblox-ai/voiceblox) — "edit in the canvas, click deploy, start talking" — is the experience we want for our prompt authors during iteration.

## Decision

Add a **preview mode** that layers on top of the existing voice-test flow without changing the production dispatch contract:

1. **New endpoint:** `POST /api/agents/:id/voice-test-token?mode=preview`. Same auth, same room/token mint, same session row. The one difference: dispatch metadata also carries the agent's current `compiledInstructions` under a clearly-namespaced field, `compiled_prompt`.
2. **Size cap:** the injected prompt is rejected with `400` if it exceeds `48 * 1024` bytes. LiveKit's JSON metadata has practical limits and we don't want a compiled prompt to bloat dispatch payloads in surprising ways.
3. **Agent-side override:** the LiveKit worker reads `compiled_prompt` from dispatch metadata in its entrypoint. When present, it constructs the `Agent` with those instructions instead of the baked-in `build_system_prompt(...)`. When absent, behavior is unchanged from ADR-014.
4. **UI labeling:** the dashboard renders a "Draft prompt — not yet deployed" badge on any voice-test session started in preview mode. The default "Talk to agent" button continues to hit the standard (non-preview) endpoint.
5. **Opt-in only:** preview mode is never the default. A user has to click "Talk with draft prompt" (or pass `?mode=preview` via API), so the ADR-014 drift risk is acknowledged each time.

### Why this doesn't contradict ADR-014

ADR-014 rejected prompt injection as the **only** path — no way to dispatch without override, no clear distinction between "testing against deployed" and "testing a draft." Those are the conditions that create silent drift.

This ADR keeps the default path (no injection, worker profile is authoritative) exactly as ADR-014 specified, and adds preview as a separate mode with its own UI affordance and label. A reviewer or admin can still tell, from the session row alone, whether the conversation exercised a deployed profile or a draft.

### Endpoint shape

`POST /api/agents/:id/voice-test-token?mode=preview`

Request: same as ADR-014 (no body).

Success response (201): same shape as ADR-014 plus `mode: "preview" | "profile"`.

Errors:

| Status | Condition |
|---|---|
| 400 | all ADR-014 400 conditions, PLUS `preview` requested on an agent with no `compiledInstructions`, PLUS compiled prompt exceeds 48 KB |
| 401, 403, 404, 500 | unchanged from ADR-014 |

### Security

- No new permission needed — `agents:activate` still gates access. If a user can voice-test the agent, they can preview draft prompts on it.
- Compiled prompt is already an authenticated-user-visible artifact (`GET /agents/:id` returns `compiledInstructions`), so dispatching it into the room via metadata doesn't widen the data exposure.
- Dispatch metadata never leaves the LiveKit region boundary — it reaches the worker only. The browser receives only the LiveKit AccessToken, not the prompt.

## Alternatives Considered

**Hot-reload the worker via a webhook.** Rejected — every redeploy+warmup would cost seconds of latency on the first call after a prompt edit, and the plumbing (worker signing, webhook auth, partial rollout) is an order of magnitude more code than a dispatch-metadata field.

**Fetch the prompt from MG API at `entrypoint`.** Considered. Simpler for multi-tenant workers (the worker already has an MG API key), but adds a round-trip to the cold-start critical path and couples every voice-test start to MG API availability. Preferred as a follow-up hardening if the metadata-size cap becomes limiting.

**Store draft prompts in a separate "preview profile" on the worker.** Rejected — requires out-of-band profile provisioning (the opposite of what this ADR is trying to solve) and doubles the number of profiles to manage.

## Consequences

- Prompt authors get sub-second iteration: compile → click → talk.
- A new opt-in code path exists on both sides of the dispatch. The MG-agent-slug ↔ worker-profile-slug contract from ADR-014 still applies — preview mode only substitutes the prompt string, not the profile selection or tool registry.
- ADR-014's rejection rationale ("drift-in-testing") is now a user-visible label instead of a prohibited path. If the drift problem bites in practice we can retire preview mode and the only blast radius is reverting one endpoint + one UI button.

## Related

- ADR-011: LiveKit outbound calls — where `dispatchAgentToRoom` was introduced.
- ADR-014: Browser voice testing — the feature this extends. Section "What this deliberately does NOT do" is the historical context this ADR revisits.
- `examples/agents/livekit-agent/README.md` — worker-side documentation for `compiled_prompt`.
