# ADR-015: Dynamic Prompt-Fetching LiveKit Agent

**Status:** Accepted (prototype)

## Context

[ADR-014](./014-browser-voice-testing.md) shipped one-click voice testing from the dashboard, but it explicitly opted **not** to inject the prompt into dispatch metadata. The rationale was sound: a worker is the authoritative source of its prompt + tools, and prompt injection at dispatch time creates a "works in voice-test, breaks in prod" drift mode.

That decision left a gap in the actual UX we want: **edit a SOP → click Compile → click Talk to agent → hear the change**. Today that loop is broken by the worker's baked-in `prompts/` module. The buildpro example (`examples/agents/livekit-agent/`) interpolates a session ID into a template that is otherwise frozen at deploy time. Recompiling a prompt in the dashboard updates `agents.compiled_instructions` in the database, but the worker never reads it — so the operator hears yesterday's prompt no matter what.

The platform also has no LiveKit-specific equivalent of the ElevenLabs "Sync" button. For ElevenLabs we push prompt + MCP config + webhook secret to the provider via `POST /agents/:id/sync`. For LiveKit there is no provider-side prompt store, so "sync" has to mean something else: **make the worker re-read the prompt at session start**.

[voiceblox](https://github.com/voiceblox-ai/voiceblox) handles this by treating the worker as a stateless prompt executor — every call starts with a fresh fetch. We want the same pattern as a first-class option on this platform.

## Decision

Add a second LiveKit example, `examples/agents/livekit-prompt-test-agent/`, that fetches its system prompt from ModelGuide on every session via a new endpoint, **`GET /api/agents/me`**:

- **Auth:** the calling agent's `mgk_*` API key in `Authorization: Bearer`. User JWTs are rejected — this endpoint exists for workers, not the dashboard.
- **Response:** the same shape as `GET /api/agents/:id`, including `compiledInstructions`. Reuses `formatAgent()` so there is one canonical shape.
- **Route ordering:** registered before `/:id` so the static `/me` segment wins over the UUID parameter.

The worker, on every session:

1. Parses dispatch metadata (carries `session_id` when the voice-test endpoint pre-created one — ADR-014's contract).
2. Calls `load_prompt()` → `GET /api/agents/me` → uses the returned `compiledInstructions` as the LLM's system prompt.
3. Falls back to a verbose `FALLBACK_PROMPT` on any error (no compiled prompt, 5xx, network blip). **Never raises**, because a voice call is already in flight by the time this runs and dead air is the worst outcome.

### Why a new agent example, not a flag on the existing one

The buildpro agent has cart tracking, reorder guardrails, and 11 MCP tools — production-shape concerns that would obscure the prompt-fetching diff. A separate `livekit-prompt-test-agent/` directory keeps the prototype small (~5 source files, ~250 LoC) and the comparison legible. Anyone who wants both behaviours can copy the `prompt_loader.py` into a fork of buildpro and override `instructions` in `__init__`; it's three lines.

### What this changes vs ADR-014

ADR-014 rejected putting prompts in **dispatch metadata**. That rejection still stands and was correct:

- It capped metadata size at 48KB and required byte-size guards.
- The MG TypeScript and the Python worker have no shared type system, so a prompt injected via dispatch could silently mismatch what the worker expected.
- A new orgs's worker would have to learn the dispatch contract to be useful.

This ADR moves the prompt source from dispatch metadata to a **dedicated authenticated REST call from the worker to the API**. That fixes all three concerns:

- Size — the API response can hold a 100KB compiled prompt with no metadata caps.
- Drift — `compiledInstructions` is a single column with a single writer (the compiler); both UI and worker read the same row.
- Discoverability — `GET /api/agents/me` is in the OpenAPI spec and discoverable by any new worker implementation.

### What this deliberately does NOT do

- **No multi-agent routing.** This worker authenticates as a single ModelGuide agent (one `mgk_*` key → one agent). If you want one LiveKit worker process serving many MG agents, look at the buildpro example's profile registry pattern; the prompt fetch in this prototype works the same way per-profile, you just need to attach the right API key per profile.
- **No tools.** The prototype is prompt-only. Adding `@function_tool` methods + an `MCPConnection` is a copy/paste from the buildpro example.
- **No prompt diff / version pinning.** Every session fetches "whatever is current". An eval suite that wants to lock the prompt should snapshot it via the compiler endpoint into the eval row, not via this worker.

## Alternatives Considered

**Bake prompt into the worker image and redeploy on every change.** Current state. Cycle time is 2–10 minutes per change; this prototype takes it to <2 seconds.

**Embed prompt in dispatch metadata.** Rejected by ADR-014 for the reasons quoted above. We considered revisiting it for the size-bounded compiled prompts only, but the metadata route still creates the drift mode (a different worker version could parse the metadata differently) without buying anything that a REST call doesn't.

**Push prompts via a new `/livekit/sync` endpoint that updates worker config.** Rejected — LiveKit Cloud has no concept of per-worker config that the platform can write to. The closest thing is `lk agent update-secrets`, which requires the `lk` CLI in the API server and a deploy roundtrip. A worker-side fetch is strictly simpler.

**Cache the prompt in the worker for N seconds.** Rejected for the prototype — the latency budget for `GET /api/agents/me` is well under 50ms against a co-located API, which is invisible compared to the ~300ms STT + 500ms LLM TTFT we already pay on the first turn. Add a cache if the API becomes a bottleneck for prod-scale workers; for the iterate-on-prompts use case, fresh-every-time is the entire point.

## Consequences

- **`GET /api/agents/me`** is a new public-shape endpoint. Its response reuses `agentResponseSchema` so any field added to the regular agent response automatically appears here. Tests guard the auth boundary (no user JWTs) and the freshness guarantee (a write must be visible on the next read).
- **Two LiveKit examples now coexist.** The buildpro example remains the reference for tool-using production agents; the new `livekit-prompt-test-agent` is the reference for prompt-iteration loops and for new orgs that don't yet have tools wired up. Both speak the same dispatch contract (ADR-014) and can be A/B-tested against the same MG agent by flipping `metadata.livekit.agentName`.
- **No new attack surface.** The `mgk_*` API key already scopes access to one agent's data; `GET /api/agents/me` returns strictly less than what a JWT-authed admin sees (no integration URLs that depend on user context, etc., all derived from the same `formatAgent()` helper, and no decrypted secrets — never were any).
- **Operator footgun:** if the worker is running but the ModelGuide agent has no compiled prompt yet, the operator hears `FALLBACK_PROMPT`, which says exactly that. That's by design — silent default behaviour would be worse.

## Tests

- **API integration (`tests/integration/agents.test.ts`):** four new tests covering happy path, "fresh write is visible to the next read", missing auth → 401, and user JWT → 401.
- **Worker unit (`livekit-prompt-test-agent/tests/`):** 17 tests across `prompt_loader` and `dynamic_agent`. The loader is tested with `httpx.MockTransport` — no network, no LiveKit. The agent's defensive `livekit.agents.Agent` import lets the tests run in bare environments (`python -m pytest`) without installing the LiveKit runtime.

Written TDD red→green: the loader tests existed and failed (`ModuleNotFoundError`) before any source file in `src/` was created.

## Related

- ADR-014: Browser Voice Testing via LiveKit Dispatch — the dispatch contract this worker plugs into.
- ADR-011: LiveKit Outbound Calls — same dispatch primitive, different metadata shape.
- `examples/agents/livekit-agent/` — the production-shape BuildPro Sam example with baked prompts + MCP tools.
- `examples/agents/livekit-prompt-test-agent/` — the prototype this ADR ships.
