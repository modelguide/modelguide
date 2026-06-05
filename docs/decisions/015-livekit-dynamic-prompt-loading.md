# ADR-015: Dynamic Prompt Loading for LiveKit Voice Agents

**Status:** Proposed (POC — `examples/agents/livekit-prompt-poc/`)

## Context

The production LiveKit example (`examples/agents/livekit-agent/`) — the BuildPro "Sam" agent — ships with its system prompt baked at build time (`src/prompts/__init__.py`: `SYSTEM_PROMPT_TEMPLATE = BASE_PROMPT + ...`). Every prompt change requires editing Python, rebuilding the worker image, and redeploying. That's fine when the worker is one-prompt-per-image, but it breaks the dashboard's "Compile prompt → Talk to agent" feedback loop:

1. Operator edits a SOP in the dashboard.
2. Operator clicks **Compile** — `agents.compiledInstructions` is updated.
3. Operator clicks **Talk to agent** — the dispatched worker uses the *baked* prompt, not the freshly compiled one. The two are silently divergent.

ADR-014 closed the door on shipping the compiled prompt **via dispatch metadata** for good reasons: byte caps, drift between voice-test and prod, and the worker-profile-as-source-of-truth principle.

That leaves a different question: **what if the worker's profile loads itself from ModelGuide at job start, instead of being baked into the image?** That preserves the "profile is authoritative" principle while giving the dashboard a live feedback loop.

This ADR documents the POC of that approach.

## Decision

Introduce a **self-profile** endpoint and a reference worker that consumes it.

### 1. API: `GET /api/agents/me`

- Auth: agent API key (`mgk_xxx`) via `requireAgent()` — never user JWT.
- Response shape: the agent's own `id`, `name`, `slug`, `description`, `modality`, `modelFamily`, `promptConfig`, `agentPlatform`, `isActive`, `compiledInstructions`, `compiledAt`, `compiledFrom`. Deliberately omits dashboard-only fields (`secrets`, `keyPrefix`, `integrationUrls`, `hasElevenLabsKey`) so the worker only sees what it needs.
- Status semantics: `200` with `compiledInstructions: null` if the agent has not been compiled — the worker decides how to fall back. `401` if the API key is invalid/inactive (worker should refuse to start).

### 2. POC worker: `examples/agents/livekit-prompt-poc/`

A minimal LiveKit agent (`src/agent.py`) that, on every job dispatch:

1. Authenticates an `httpx.AsyncClient` with the worker's `MODELGUIDE_API_KEY`.
2. Calls `GET /api/agents/me` and parses the response into `mg_profile.AgentProfile`.
3. Resolves the system prompt via `mg_profile.resolve_system_prompt(profile)`:
   - If `compiled_instructions` is set, that's the prompt.
   - Otherwise, fall back to a clearly-labelled placeholder that tells the caller "I'm running with a fallback — compile the prompt in the dashboard". No silent canned responses.
4. Boots an `AgentSession` (STT/LLM/TTS) with that prompt as `Agent(instructions=...)`.

No tools, no business logic — the POC is deliberately minimal so the prompt-loading mechanism is the only moving part. Adding MCP-backed tools is a separate concern (the same `mg_profile.fetch_profile` pattern composes with `mg_client.MCPConnection` from the buildpro example).

### 3. UI: `VoiceTestPanel` prompt indicator

The "Talk to agent" panel now shows:

- **When compiled:** small `Compiled prompt · {N} chars · {relative time}` chip so the operator knows what the next dispatch will pick up.
- **When uncompiled:** a warning that the worker will use the placeholder fallback.

The dispatch flow is otherwise unchanged from ADR-014. The operator's mental model is: *Compile sets the prompt; Talk to agent invokes it.* No extra "Sync" step is required for the POC worker — clicking Talk *is* the sync, because the worker fetches at dispatch time.

## Consequences

### Positive

- **Single worker image serves any agent.** The same container can be dispatched for `glowbox-store`, `bank-nowa2`, or any future org without a per-agent rebuild. Mass-multi-tenant.
- **Tight feedback loop preserved.** Compile → Talk → hear the new prompt within ~2 s of the click (one extra REST call before AgentSession.start; ~50 ms in practice).
- **No prompt-in-metadata regression.** ADR-014's "profile is authoritative" principle is preserved — the worker's profile *is* the compiled prompt, just loaded live instead of baked.

### Negative / risks

- **Cold start adds one REST round-trip.** ~30–80 ms typical, against a healthy ModelGuide API. Acceptable for voice-test; could be cached for production traffic.
- **Worker now depends on the API at job start.** If the API is down, the worker can't boot. Mitigation: future hardening should add a short in-memory cache (last-known-good prompt) so a transient API blip during a dispatch doesn't drop the call.
- **No tools in the POC.** A real prompt-driven worker still needs MCP tools, persona-driven greeting, hangup detection, etc. The POC proves the loading mechanism; productionising this approach means folding `mg_profile` into the existing `MCPAgent` base class so BuildPro-style agents can opt in.
- **Prompt compilation drift.** If the dashboard publishes a malformed prompt, the worker has no schema validation — it just uses whatever string came back. The compiler is the gatekeeper; consider versioning the compiled prompt (`compiledFrom.compilerVersion`) once the POC graduates.

### Compared to ADR-014's rejected "prompt-in-metadata"

| Concern | metadata-injection | self-profile fetch |
|---|---|---|
| Byte caps on dispatch metadata | hits 48KB limit at ~25K chars | n/a — prompt is fetched, not transported |
| Drift between voice-test and prod | yes — voice-test bypasses worker's "real" prompt | no — *all* dispatches (voice-test, outbound, inbound) read the same source |
| Audit trail | dispatch metadata is ephemeral | `compiledAt` + `compiledFrom` already persisted |
| "Where did this prompt come from?" | "look at the LiveKit dispatch log if it hasn't aged out" | "look at `agents.compiledInstructions`" |

## Alternatives Considered

**Bake the prompt at deploy time, redeploy per change.** The status quo. Rejected because it kills the dashboard feedback loop for non-engineers and turns a 2-line SOP edit into a CI run.

**Embed the prompt in LiveKit dispatch metadata.** Rejected in ADR-014. The POC explicitly avoids reopening that door — nothing in `dispatchVoiceTestMetadata` carries prompt content.

**Push the prompt to the worker via a sidechannel (Redis pub/sub, websocket).** Over-engineered for the problem. The worker already authenticates with ModelGuide for MCP — reusing that auth and HTTP path is simpler than introducing a new transport.

**A `POST /agents/:id/livekit-sync` admin endpoint that mutates worker state.** Rejected — implies stateful workers that hold per-agent config in memory. The fetch-on-dispatch model keeps workers stateless.

## Test coverage

- **API integration:** `tests/integration/agents.test.ts → GET /api/agents/me` — happy path with compiled prompt, uncompiled-fallback (`null`), user-JWT rejection, unauthenticated rejection.
- **Worker unit:** `examples/agents/livekit-prompt-poc/tests/test_mg_profile.py` — `fetch_profile` parses both states, raises on 401, and `resolve_system_prompt` picks the compiled prompt when present / a labelled fallback when not.
- **UI:** `voice-test-panel.test.tsx` — renders the compiled-prompt chip with the correct length when available, falls back to the warning when not.

End-to-end (browser → LiveKit → POC worker → API → audio response) is a manual gate, documented in the POC README.

## Related

- ADR-011: LiveKit Outbound Calls — the dispatch primitive this POC consumes.
- ADR-014: Browser Voice Testing — defines the dispatch contract and rejected prompt-in-metadata.
- `examples/agents/livekit-prompt-poc/README.md` — operator instructions.
