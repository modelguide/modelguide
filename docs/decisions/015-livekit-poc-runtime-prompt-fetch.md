# ADR-015: LiveKit POC Agent with Runtime Prompt Fetching

**Status:** Accepted (Prototype-only — not for production)

## Context

ADR-014 ships the production voice-test path: the dashboard dispatches the configured LiveKit worker into a fresh room with the agent's slug in metadata, the worker reads its profile out of an in-image registry, and the operator hears the agent. That's the right shape for production — reproducible, auditable, no drift between "what we tested" and "what's deployed."

It is not the right shape for the prompt-authoring inner loop. Today an admin who edits a persona / language / SOP and clicks **Compile** in the dashboard gets a fresh `compiledInstructions` blob saved on the agent row — but the deployed worker doesn't see it. To test the new prompt they have to either:

1. **Rebuild and redeploy** the worker with the new prompt baked into a profile file. Slow (~minutes), expensive in CI cycles, awkward for "is the tone right?" iteration.
2. **Run a local worker** with the prompt file copied in by hand. Works, but bypasses LiveKit Cloud entirely and doesn't exercise the production transport.

Neither matches the "compile → click test → talk" loop the user gets from competitors (e.g. voiceblox-ai/voiceblox) and from our `~/Project/modelguide/website` prototype.

ADR-014 explicitly rejected a third option — passing the compiled prompt through dispatch metadata — for sound reasons: byte-size guards, "works-in-voice-test, breaks-in-prod" drift, the worker's profile is the authoritative source of truth. Those reasons still stand for the production endpoint.

We want a prototype that:

- Lets an operator iterate on the prompt end-to-end in seconds.
- Doesn't undermine ADR-014's production guarantees.
- Doesn't pull a prompt blob through `dispatch_metadata` (the design ADR-014 vetoed).
- Is obviously a prototype — not a thing anyone accidentally enables in production.

## Decision

Build a separate LiveKit worker — `examples/agents/livekit-poc-agent` — that fetches its compiled prompt from ModelGuide **at session start** via a new authenticated endpoint, and gate everything in the repo around the "prototype" framing.

### Components

1. **New API endpoint** — `GET /api/agents/me` (`modelguide-api/src/features/agents/agents.routes.ts`):
   - Auth: agent API key (`mgk_...`) via `requireAgent()`.
   - Response: narrow projection of the agent row — `id`, `name`, `slug`, `description`, `modality`, `modelFamily`, `agentPlatform`, `promptConfig`, `compiledInstructions`, `compiledAt`, `isActive`. **No secrets, no integration URLs, no `organizationId`, no metadata.**
   - The projection is locked by `tests/unit/agents/agent-me-shape.test.ts` (`formatAgentMe`), pinned to exactly 11 keys so a future refactor can't widen it without flipping a test.

2. **New worker** — `examples/agents/livekit-poc-agent/`:
   - On dispatch, calls `GET /api/agents/me` with its own API key.
   - Uses `compiledInstructions` as the LLM system prompt; falls back to a configured stub (with a clear "no prompt is compiled" greeting) if the dashboard operator hasn't compiled one yet.
   - Crashes loud on profile-fetch failure so the operator hears a dispatch error, not a stub agent pretending to be the real one.
   - Provider stack matches the production agent — Deepgram STT, OpenAI LLM, ElevenLabs TTS, Silero VAD, EnglishModel turn detection — so transport behaviour is identical.

3. **Unchanged voice-test dispatch contract.** `buildVoiceTestDispatchMetadata` keeps its five fields. The POC worker reads the same metadata as the production worker, so we can swap one for the other by changing `metadata.livekit.agentName` on the agent record. No new field, no byte-size guards, no `prompt_override`.

### Why this isn't the design ADR-014 rejected

| | ADR-014 rejected (`prompt_override` in dispatch metadata) | ADR-015 (runtime fetch via `/api/agents/me`) |
|---|---|---|
| Where does the prompt travel? | LiveKit dispatch payload (signed by LK creds, opaque to ModelGuide) | Authenticated HTTPS call (signed by MG API key, observable by MG) |
| Who is the source of truth? | Whoever crafted the dispatch metadata for this single call | The agent row in Postgres |
| Drift risk between "test" and "prod"? | High — different prompt content per dispatch | Low — same row, same prompt; the production worker just chooses to bake it instead of fetching |
| Byte-size guards needed? | Yes (~100 lines, 50K char cap, 48KB metadata cap) | No — HTTPS body has no relevant ceiling |
| Auditability? | Prompt blob only visible in worker logs | Every fetch is an authenticated MG access log entry |
| Production safety? | Anyone with dispatch perms can inject any prompt | Only the agent's own API key can read its own prompt |

The compiled prompt is *the same value* the production worker would bake into its image — we just read it from the database instead of from a file. The "voice-test passes, prod breaks" drift mode ADR-014 was worried about doesn't apply: this isn't a parallel prompt for testing, it's the canonical prompt being read live.

### Production positioning

The POC is fenced off in three ways so nobody runs it as a production worker:

1. **Directory name** — `examples/agents/livekit-poc-agent`, not `agents/livekit-poc-agent`. Examples are not deployable artifacts.
2. **README front-matter** — opens with "not intended to ship to production" and a comparison against ADR-014.
3. **No MCP, no transcript posting, no SIP, no Langfuse.** The POC is intentionally tool-less so it can't accidentally take over a production agent's responsibilities. Operators who want those features deploy `examples/agents/livekit-agent`.

If the production agent eventually wants the live-fetch behaviour too (e.g. for staged rollouts), the `/api/agents/me` endpoint is reusable — but that's a separate decision, requiring its own ADR weighing the redeploy-vs-staleness tradeoff.

### Endpoint shape

`GET /api/agents/me` — permission inherited from `requireAgent()` (active agent API key).

| Status | Condition |
|---|---|
| 200 | Returns the projection above |
| 401 | Missing / invalid / inactive API key, or key is a user JWT instead of `mgk_...` |

`requireOrganization()` is bolted on so the request still passes the standard org-isolation guards even though the agent's org is inferred from the key.

### Security

- The key never sees an agent it doesn't own — `getAgentById(orgId, authAgent.id)` is the only lookup, scoped by RLS.
- The projection drops `secrets`, `metadata`, `integrationUrls`, `organizationId`. A compromised worker key can read its own prompt and nothing else.
- `compiledInstructions` is markdown the operator authored themselves — no PII expansion happens here.

## Alternatives Considered

**Pass `instructions` in dispatch metadata.** Rejected — explicitly the design ADR-014 vetoed, and the byte-size + drift concerns still apply. Going through the authenticated API is no slower in practice (one extra HTTPS round trip during worker boot, ~50ms on the same region).

**Add the prompt to the LiveKit AccessToken claims.** Rejected — tokens are meant to be short and grant-shaped, not a config blob channel. JWT size limits would force the same byte-size guards we wanted to avoid.

**Have the dashboard sync the prompt to a worker registry (Redis / DB shared with the worker).** Rejected for the prototype — adds infrastructure for a feature whose whole point is "fewer moving parts." Worth revisiting if/when the live-fetch pattern graduates to the production agent.

**Make `/api/agents/me` return everything the dashboard's `GET /api/agents/:id` returns.** Rejected — broader projection means more chances to leak secrets to a worker process. The narrow shape is the security model.

**Re-use `GET /api/agents/:id` with the agent's own ID.** Rejected for two reasons: that endpoint requires a *user* JWT (`requireUser` + `agents:read`), so an agent key can't call it; and it returns secret refs and integration URLs that the worker has no business seeing.

## Consequences

- The "edit prompt → talk to it" loop drops from minutes to seconds. Operators iterate faster on persona / language / SOP changes during demos and pilot setups.
- One new endpoint to maintain (`GET /api/agents/me`). Surface area increase is small — single read, narrow projection.
- The MG-agent-slug ↔ worker-profile-slug contract from ADR-014 remains the production source of truth. The POC's existence doesn't change how the production agent boots.
- The contract between the API response shape and the Python `AgentProfile.from_api` is enforced by paired tests:
  - TypeScript: `modelguide-api/tests/unit/agents/agent-me-shape.test.ts`
  - Python: `examples/agents/livekit-poc-agent/tests/test_mg_client.py::TestAgentProfileFromApi`
  - Integration: `modelguide-api/tests/integration/agents-me.test.ts`
- The POC is fenced off in `examples/` and won't accidentally serve production traffic. If we ever decide to merge the two agents, that's a follow-up ADR — not an opt-in flag.

## Known test gap

The full end-to-end loop (dashboard click → dispatch → worker fetch → compiled prompt heard in audio) is not covered by automated tests, because:

- A real LiveKit dispatch can't be exercised in CI (same gap called out in ADR-014).
- Deepgram / OpenAI / ElevenLabs are real-money external dependencies.

What's covered instead:

- API contract (shape + auth) via the two test files above.
- Python client behaviour (parse, resolve, HTTP error taxonomy) via 13 unit tests.
- Production voice-test dispatch metadata is untouched, so ADR-014's existing 5 unit tests still guard the production path.

Risk: a refactor that swaps the projection's field names without updating both sides silently breaks the worker's prompt fetch — the worker falls back to its stub and the operator hears "no prompt is compiled" with no error. Mitigation: when changing `formatAgentMe`, run both `make api-test-unit` *and* `make lk-poc-test` (the latter would catch the missing field on `AgentProfile.from_api`).

## Related

- ADR-011: LiveKit Outbound Calls — the dispatch plumbing both agents share.
- ADR-014: Browser Voice Testing — the production design this prototype intentionally sits beside without modifying.
- `examples/agents/livekit-poc-agent/README.md` — operational guide.
- `examples/agents/livekit-agent/` — the production reference.
