# ADR-015: Dynamic Prompt Loading for LiveKit Workers (POC)

**Status:** Accepted (POC scope only — production workers continue to follow ADR-014)

## Context

ADR-014 ("Browser Voice Testing") deliberately rejected injecting the compiled prompt at dispatch time:

> The worker's profile is the authoritative source of prompt + tools. Injecting a different prompt creates a "it works in voice-test but broke in prod" failure mode.

That's the right call for a deployed production agent — the prompt is reviewed, versioned, and tied to the worker image. But it makes the iteration loop slow when an admin is *writing* the prompt:

1. Edit persona / language / filler phrases in the dashboard.
2. Click **Compile**.
3. Redeploy the worker so it picks up the new compiled prompt.
4. Click **Talk to agent**.
5. Repeat.

Step (3) is the friction. For a working session of prompt iteration it dominates. We want the same one-click loop the public website offers: edit → compile → talk → repeat — measured in seconds, not minutes.

## Decision

Add a dedicated POC LiveKit worker (`examples/agents/livekit-poc`) that **fetches its compiled prompt from ModelGuide at session start** instead of having it baked into the image.

### What ships

1. **`GET /api/agents/me/runtime-config`** — agent-authenticated endpoint (API key, `mgk_*`) that returns the minimum runtime contract:

   ```ts
   {
     id, name, slug, modality, isActive,
     instructions: string | null,   // ← the compiled prompt
     promptConfig: { persona?, language?, fillerPhrases? },
     compiledAt: string | null,
   }
   ```

   Pure projection (`formatRuntimeConfig` in `agents.service.ts`) — locked behind unit tests because the worker has no type-system connection to the API.

2. **POC worker** at `examples/agents/livekit-poc/`:
   - On `entrypoint`, opens the room and calls `mg_client.fetch_runtime_config()` in parallel with `wait_for_participant()`.
   - Passes `runtime_config["instructions"]` verbatim to `Agent(instructions=...)`.
   - Falls back to a generic default prompt if the API is unreachable or the agent was never compiled (so the call doesn't dead-air).
   - Conversation-only — no MCP tools — to keep the POC's scope to the prompt-loading contract.

3. **No UI changes.** The existing "Talk to agent" button in the dashboard already dispatches the worker named in `metadata.livekit.agentName`. Configuring that name to point at the POC worker is all it takes.

### Why a separate POC worker, not a flag on the production worker

Keeping the two patterns physically separate is the whole point. The production worker (`examples/agents/livekit-agent`) ships the prompt as part of its image; the POC worker doesn't. They have different operational profiles:

| | Production worker | POC worker |
|---|---|---|
| Prompt source | Baked into image | API fetch per session |
| Survives MG API outage | Yes (degrades to last-image prompt) | Yes (falls back to default prompt) |
| Prompt review gate | Image build / PR | Dashboard click |
| Right use case | Customer-facing | Iteration, demos, smoke tests |

Mixing modes on one worker via a flag would tempt operators to flip the flag on production-facing agents, which is exactly the failure mode ADR-014 wanted to avoid.

### Endpoint shape & security

`GET /api/agents/me/runtime-config` — `requireAgent()` middleware (API key auth) + `requireOrganization()`.

| Status | Condition |
|---|---|
| 200 | runtime config returned |
| 401 | not authenticated; user JWT used instead of `mgk_*` key |
| 404 | agent referenced by the key was deleted (very rare) |

- The endpoint never returns platform secrets, webhook config, or LiveKit credentials — only the seven runtime fields above. Unit-tested explicitly.
- Same RLS pattern as every other agent endpoint: `forOrg(agent.organizationId, ...)` ensures cross-org reads are impossible.
- `compiledInstructions` is renamed to `instructions` on the wire so the worker can pass the field straight through to LiveKit's `Agent(instructions=...)` constructor without re-mapping.
- `promptConfig` is collapsed from `null` to `{}` on the wire so the worker code stays branch-free.

### Failure mode

If `fetch_runtime_config()` fails — network, expired key, deleted agent — the worker:

1. Logs a warning with the response status (or "network error").
2. Returns `None` from `fetch_runtime_config()`.
3. `build_session_instructions(None)` returns the generic default prompt.
4. The session continues; the caller hears a voice instead of dead air.

This is intentional: a prompt-iteration POC that crashes when the API hiccups is worse than one that gracefully degrades to a generic assistant — the worker is still useful as a smoke test for the LiveKit pipeline itself.

## Alternatives Considered

**Inject the prompt in dispatch metadata.** Rejected — same arguments as ADR-014. Couples the dashboard's dispatch payload to the worker's runtime contract, and adds metadata-size guards (the LiveKit dispatch envelope is ~48KB). An API fetch is cleaner: the worker owns the call, the dashboard's dispatch payload stays small.

**Reuse `GET /api/agents/:id`.** Rejected — that endpoint is user-auth only (`requireUser` + `agents:read` permission). Punching API-key auth into it would widen the surface; the data shape would also force the worker to either decode `compiledInstructions` itself or accept dashboard-only fields like `evalSuiteCount` and `integrationUrls`. A dedicated projection keeps the contract small.

**Have the worker poll for prompt changes mid-call.** Rejected — the LLM context is established at session start. Swapping the system prompt mid-conversation either does nothing (most providers ignore in-flight system prompt edits) or surprises the LLM in ways that hurt eval quality. Per-session fetch is the right granularity.

**Cache the runtime config in memory (with TTL).** Rejected for the POC — caching obscures the "edit → compile → next session uses it" guarantee that's the whole point. If load becomes a concern in production, the cache can be added with a TTL ≤ "time from compile click to user clicking Talk".

## Consequences

- The "edit → compile → talk" loop in the dashboard now matches the website experience. Round-trip time from compile click to hearing the new prompt is ~3-4s (dispatch + WebRTC connect + API fetch + LLM first-token).
- The POC worker is a small dependency surface — one new endpoint, no schema changes, no migrations. Easy to delete if we decide against the pattern.
- A regression in `formatRuntimeConfig` or `fetch_runtime_config` silently breaks the loop (the worker keeps running on whatever stale prompt it has, or the default fallback). Mitigation: both sides are covered by unit tests that lock the field names and the error-handling contract.
- Production agents still follow ADR-014 — image-baked prompt is the path to a customer-facing voice agent. The POC worker is explicitly labelled as such in the README and isn't recommended for that role.

## Test coverage

- `modelguide-api/tests/unit/agents/runtime-config.test.ts` — wire shape locked: exactly the seven fields, `compiledInstructions → instructions` rename, `compiledAt` → ISO string, no secrets leak.
- `modelguide-api/tests/integration/agents.test.ts` — `GET /api/agents/me/runtime-config` happy path, latest-prompt-after-recompile, 401 unauth, 401 user-JWT-rejected, secret-leak regression guard.
- `examples/agents/livekit-poc/tests/test_mg_client.py` — endpoint URL is locked, 4xx/network errors return `None` (no raise), missing `instructions` field handled.
- `examples/agents/livekit-poc/tests/test_prompts.py` — compiled prompt verbatim, default fallback when missing/None, prompt-config not silently merged into compiled string.

## Related

- ADR-014: Browser Voice Testing — the dispatch flow this POC plugs into; explains why the production agent does *not* inject prompts.
- ADR-011: LiveKit Outbound Calls — sibling LiveKit feature, same dispatch + token pattern.
- `examples/agents/livekit-poc/README.md` — operator guide for the POC worker.
- `examples/agents/livekit-agent/README.md` — production-shaped voice agent (image-baked prompt + MCP tools).
