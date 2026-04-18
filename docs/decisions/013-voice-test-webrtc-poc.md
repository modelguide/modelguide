# ADR-013: Dashboard "Talk to agent" WebRTC voice test

**Status:** Accepted (POC)

## Context

ADR-011 shipped PSTN outbound calls via LiveKit: an admin clicks "Make Call" on an agent page, types a phone number, and LiveKit dispatches the configured agent worker to dial out. That flow proves that the worker, the SIP trunk, and the dashboard-to-LiveKit control plane are all wired up — but it has two friction points for the inner loop of prompt authoring:

- **Phone call required.** To try a prompt change you need a phone and a trunked number. Iterating on SOP wording or persona tone in a Slack thread means paying for a PSTN leg per tweak.
- **No guarantee the prompt under test matches the dashboard.** The worker ships with a bundled system prompt (`prompts/base.py` + workflows). The dashboard's compiled prompt — the thing the evals run against and the authors actually edit — is not what the caller hears unless the worker is redeployed.

Voiceblox ([github.com/voiceblox-ai/voiceblox](https://github.com/voiceblox-ai/voiceblox)) and LiveKit's own `agents-playground` both handle this with a WebRTC "Connect" button in-app: the backend mints a short-lived LiveKit access token, the browser joins the room with `livekit-client`, and the agent worker is dispatched into the same room with the desired instructions as metadata.

We want the same inner loop for ModelGuide: author edits SOPs → clicks **Compile** → clicks **Talk to agent** → actually hears the new prompt within seconds, without redeploying the worker.

## Decision

### Architecture

```
Browser ──(1) POST /agents/:id/voice-test-token ──▶ API
                                                     │
                                      (2) create session + dispatch worker
                                                     │
                                                     ▼
                                               LiveKit Cloud ◀── Worker (agent.py)
                                                     ▲                 │
                                      (3) mint AccessToken              │ (4) reads metadata:
                                                     │                   │    { mode: "voice-test",
Browser ◀── (5) AccessToken + wss URL ──────────────┘                   │      prompt_override,
   │                                                                     │      session_id }
   │ (6) room.connect(url, token) + publishTrack(mic)                    │
   └──────────────────────────▶ LiveKit room ◀──────────────────────────┘
                                WebRTC audio both ways
```

1. Dashboard posts to `POST /api/agents/:id/voice-test-token`.
2. API looks up the agent's existing LiveKit config (reused from ADR-011), creates a ModelGuide voice session with `userMetadata.voiceTest: true`, and dispatches the configured worker to a fresh room `voice-test-<nanoid>`. Dispatch metadata carries `mode: "voice-test"`, `session_id`, `user_identifier`, and `prompt_override: <agent.compiledInstructions>`.
3. API mints a short-lived LiveKit `AccessToken` (default 15 min) scoped to that single room with `roomJoin`, `canPublish`, `canSubscribe` grants.
4. Worker `entrypoint` in `examples/agents/livekit-agent/src/agent.py` parses the dispatch metadata. When `mode == "voice-test"`, it feeds `prompt_override` into `BuildProAgent` as `instructions_override`, which replaces the bundled system prompt (runtime placeholders like `{{mg_session_id}}` and `{{userEmail}}` are still interpolated).
5. The endpoint returns `{ livekitUrl, roomName, token, sessionId, dispatchId, agentName, identity }`.
6. Browser uses `livekit-client`'s `Room` to `.connect(url, token)`, publishes a local mic track, and attaches the worker's subscribed audio track to an `<audio>` element. When the worker leaves or the user clicks "Hang up", the room is disconnected and the local track is stopped.

### What's reused from ADR-011

- `metadata.livekit.{url, agentName}` — unchanged.
- `secrets.livekit_api_key` / `secrets.livekit_api_secret` — unchanged; decrypted server-side just long enough to mint the token and call `AgentDispatchClient.createDispatch`.
- `dispatchAgentToRoom` helper — unchanged; the only difference is the metadata payload.

### What's new

- `generateVoiceTestToken` in `modelguide-api/src/features/agents/livekit.ts` — wraps `AccessToken` with sensible defaults for voice-test (15 min TTL, publish+subscribe grants, roomJoin).
- `createVoiceTestSession` in `agents.service.ts` — orchestrates session creation, dispatch, and token minting; rolls the session to `abandoned` if dispatch fails.
- `POST /agents/:id/voice-test-token` — gated by `agents:activate` permission (same as `outbound-call` and `livekit-ping`), returns `400` if LiveKit is not configured and `404` for missing or cross-org agents.
- Python `buildpro.BuildProAgent(instructions_override=...)` — when truthy, replaces the built-in system prompt and still runs `{{mg_session_id}}`/`{{userEmail}}`/`{{channel}}` interpolation so authors can templatize compiled prompts.
- `VoiceTestPanel` in the dashboard — one button per LiveKit agent, disabled until both LiveKit config and a compiled prompt exist.

### Permission model

Voice-test is `agents:activate` (admin-only) to match the existing runtime endpoints. Viewers see the panel but the button is disabled. Tokens are minted per request and are scoped to one room, with a default TTL well below the LiveKit 1h maximum.

### What's out of scope for this POC

- **Prompt injection from the body.** We deliberately only use the server-side `agent.compiledInstructions` as the override source. Passing a caller-supplied prompt would let anyone with `agents:activate` run arbitrary system prompts against their own LiveKit credentials — acceptable for self-serve but tangential to the inner loop we're trying to close, and better handled explicitly if ever needed.
- **Transcript UI.** The existing sessions page already shows transcripts; voice-test sessions land there under a normal voice session tagged `userMetadata.voiceTest`. A separate live-transcript pane is a follow-up.
- **Recording downloads, screen share, telemetry overlays.** Voiceblox-style. Not needed to validate the prompt-sync loop.
- **Multi-agent or multi-worker scenarios.** Each call dispatches exactly one worker into a fresh room.

## Consequences

- Admins can iterate on prompts with compile → talk loops that take ~2 seconds once the worker is warm; no redeploy required.
- The worker treats voice-test dispatches exactly like any other session (same transcript, feedback, and eval paths). Voice-test sessions carry `userMetadata.voiceTest: true` so we can filter or exclude them from analytics later if we want.
- `prompt_override` is only ever applied when `mode == "voice-test"`; the inbound and outbound flows in ADR-011 keep the bundled system prompt.
- The `AccessToken` TTL is short. If a caller leaves the tab open and re-joins after the TTL, they'll see a LiveKit auth error and need to click "Talk to agent" again. That's the right tradeoff — the alternative is long-lived tokens leaking out of the browser.
- `livekit-client` adds ~120KB gzipped to the dashboard bundle. Acceptable for an admin tool.
