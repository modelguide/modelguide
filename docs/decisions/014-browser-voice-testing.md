# ADR-014: Browser Voice Testing via LiveKit Dispatch

**Status:** Accepted. The "No prompt injection" subsection is superseded by [ADR-015](./015-voice-test-prompt-override.md) — voice-test now ships the agent's latest compiled prompt via dispatch metadata.

## Context

Admins need a tight feedback loop to hear how a voice agent actually sounds. Before this change, the only ways to exercise a LiveKit voice agent were:

1. **Outbound phone call** (`POST /agents/:id/outbound-call`, ADR-011) — costs PSTN minutes, requires a phone in hand, not viable for quick iteration during a prompt or SOP edit.
2. **Local worker + LiveKit Meet** — fiddly token generation, doesn't hit the deployed worker, and defaults to whatever prompt the worker was packaged with (not what's configured per-profile).

We wanted the same one-click experience users get elsewhere in the platform: from the agent detail page, click a button and start talking.

## Decision

Add `POST /api/agents/:id/voice-test-token`. On success it:

1. **Creates a ModelGuide session** (`createSession`) so the conversation is attributed and lands in the normal transcript / feedback / analytics pipeline.
2. **Dispatches the configured LiveKit worker** into a fresh `voice-test-<nanoid>` room with JSON metadata `{ mode: "voice-test", agentName, session_id, user_identifier, email }`.
3. **Mints a short-lived LiveKit AccessToken** (15 min TTL) scoped to that single room, with `roomJoin` + `canPublish` + `canSubscribe` grants and the caller's identity.
4. **Returns** `{ livekitUrl, roomName, token, sessionId, dispatchId, agentName, profileName, identity }` so the browser can connect via WebRTC.

The browser side (`VoiceTestPanel` in `modelguide-ui`) runs a mic pre-flight probe, then mounts `<LiveKitRoom>` with the returned token and renders the in-call toolbar.

### Multi-profile dispatch contract

The dispatch metadata carries `agentName: agent.slug` — **not** the LiveKit worker-level `agent_name`. This is the coupling that makes multi-profile workers route correctly:

- `metadata.livekit.agentName` on the MG agent record → LiveKit worker identity (WHICH worker process to dispatch into)
- `agent.slug` → profile identity inside that worker (WHICH profile to instantiate)

A multi-profile worker's entrypoint reads `dispatch_metadata.get("agentName")` and looks it up in its in-memory profile registry. If the slugs don't match, the worker ignores the dispatch and the room stays empty until the client-side 15s timeout fires.

This contract is locked behind a pure-function unit test (`buildVoiceTestDispatchMetadata` in `agents.service.ts` + `tests/unit/agents/voice-test-dispatch.test.ts`) because there's no type system connecting the MG TypeScript to the worker implementation.

### What this deliberately does NOT do

- **No prompt injection.** Earlier iterations (see the closed #234, #239) shipped a `prompt_override` / `instructions_override` field in dispatch metadata so an admin could test a compiled prompt without redeploying the worker. We rejected this because:
  - The worker's profile is the authoritative source of prompt + tools. Injecting a different prompt creates a "it works in voice-test but broke in prod" failure mode.
  - It added ~100 lines of byte-size guards (50K char cap + 48KB metadata cap) to bound the injected prompt.
  - If you want to test a new prompt, build a new profile on the worker and dispatch to it.
- **No "compiled prompt required" gate.** Any LiveKit-configured agent with an active worker profile can be voice-tested.

### Endpoint shape

`POST /agents/:id/voice-test-token` — permission `agents:activate`.

Error taxonomy:

| Status | Condition |
|---|---|
| 400 | agent not active; modality ≠ voice; platform ≠ livekit; LiveKit URL/agentName missing; LiveKit secrets missing from vault |
| 401 | unauthenticated |
| 403 | authenticated but lacks `agents:activate` (e.g. support role) |
| 404 | agent doesn't exist, or exists in a different org (cross-org always 404 to avoid enumeration) |
| 500 | unexpected error from LiveKit dispatch or token mint (session rolled to `abandoned`; original error rethrown) |

### Security

- AccessToken is HMAC-signed by the org's LiveKit API secret, stored encrypted in the secrets vault, retrieved via RLS-scoped `getAgentSecretByType`. Secret never leaves the server.
- Token grants are room-scoped (`room: "voice-test-<nanoid>"`) — cannot be exchanged for a different room.
- Room name uses 21 chars of crypto-random (nanoid) — unguessable; another caller can't enumerate into an active room.
- 15 min TTL caps the exposure window of a lost token.
- No admin-level grants. The token only allows join / publish mic / subscribe audio / publish data — not room administration.

## Alternatives Considered

**Mint the token client-side from the stored LiveKit secret.** Rejected — would require shipping the secret to the browser. Keep secrets server-side, end of story.

**Stateless tokens (no ModelGuide session row).** Rejected — the platform's transcript / feedback / analytics all key on session IDs. Skipping session creation would orphan voice-test conversations from the rest of the dashboard.

**Use one token for all voice tests on an agent (cache + reuse).** Rejected — tokens are tied to a specific room; reuse across rooms requires re-minting. Caching is a false optimization when token generation is a single HMAC sign (sub-millisecond).

**Embed prompt in metadata to test an un-deployed prompt change.** Rejected (see "What this deliberately does NOT do" above) — creates a drift-in-testing failure mode that's worse than the redeploy cost it tries to avoid.

## Consequences

- One-click voice test from the dashboard. Round-trip time from click to audio is ~2s (token + dispatch + WebRTC connect + agent boot).
- The MG-agent-slug ↔ worker-profile-slug contract is now load-bearing. If someone renames an MG agent's slug without touching the worker's profile configuration, voice-test silently fails — 15s timeout, "Waking up agent..." spinner, no clear error. Mitigation: future hardening opportunity is to validate the slug matches a known profile at agent-LiveKit-config time (e.g. by adding a `GET /livekit/profiles` diagnostic on the worker that the MG API can poll).
- The feature requires `agentPlatform === "livekit"` with valid `metadata.livekit.url + agentName` and both LiveKit secrets. If the admin hasn't provisioned those, the UI disables the "Talk to agent" button and shows a warning. No silent failure mode.
- Outbound calls (ADR-011) are unaffected — both features share `dispatchAgentToRoom` but no other state. The dispatch metadata shape differs (outbound carries `phone_number`; voice-test carries `agentName`) and that's intentional.

## Known test gap

The happy path (dispatch + token mint + 201 response) has no end-to-end integration test because:

- Dispatching against a real LiveKit server is out of scope for CI.
- Mocking `livekit-server-sdk` after `agents.service.ts` has already imported it (as the route path requires) doesn't propagate reliably via Bun's `mock.module` — the binding is captured at module load.
- The alternative (extensive drizzle-internals mocking to call `createVoiceTestSession` directly from a unit test) would test the mock harness more than the code.

What's covered instead:

- Contract-shape of dispatch metadata via `buildVoiceTestDispatchMetadata` (pure helper, 5 unit tests).
- All seven error paths as integration tests: not configured (400), unauthenticated (401), cross-org (404), unknown agent (404), inactive (400), non-voice modality (400), non-livekit platform (400), wrong role (403).

Net risk: a refactor that reorders the orchestration in `createVoiceTestSession` (e.g. minting the token before the dispatch, or dispatching before the session row exists) would pass CI. Follow-up: if this feature becomes load-bearing in production, harden by either introducing a thin dependency-injection layer on `createVoiceTestSession` or spinning up a LiveKit test server in CI.

## Related

- ADR-011: LiveKit Outbound Calls — the existing dispatch + token pattern this extends.
- ADR-013: Mocked Connectors — unrelated feature, different number space.
- PR #240: initial implementation.
- PR #242 (stacked): voice-activity equalizer UI polish.
