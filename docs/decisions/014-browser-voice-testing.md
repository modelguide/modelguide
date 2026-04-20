# ADR-014: Browser Voice Testing for LiveKit Agents

**Status:** Accepted (POC)

## Context

Admins compile a prompt in the ModelGuide dashboard (`POST /agents/:id/compile`) and then need a tight feedback loop to hear how the agent sounds. Before this POC, the only way to test a LiveKit voice agent was:

1. Place an outbound phone call (`POST /agents/:id/outbound-call`) — costs PSTN minutes, requires a phone, doesn't work for quick iteration
2. Run the agent locally (`make lk-agent-dev`) and join `meet.livekit.io` with a hand-generated token — fiddly, doesn't use the deployed worker, doesn't test the production prompt

We want the same experience as [voiceblox](https://github.com/voiceblox-ai/voiceblox): *compile prompt → click Test → start talking*, all from the dashboard, against the **deployed** agent worker, using the **latest** compiled prompt.

Requirements:

- One-click voice test from the agent detail page
- Talks to the agent running in LiveKit Cloud — no local dev server needed
- Runs the prompt the admin just compiled, without redeploying the worker
- Reuses the same LiveKit room/dispatch infrastructure as outbound calls (ADR-011)
- Creates a ModelGuide session so the conversation lands in the existing transcript / feedback / analytics pipeline

## Decision

Add a **browser voice test flow** that mints a short-lived LiveKit access token server-side and connects the browser to a fresh room where the agent is dispatched.

### Architecture

```
┌─────────────────┐   1. POST /agents/:id/browser-call   ┌──────────────────┐
│ modelguide-ui   │ ────────────────────────────────────▶│ modelguide-api   │
│ BrowserCallDlg  │                                      │ createBrowserCall│
└─────────────────┘ ◀───────────────────────────────────┤                  │
        │            2. { token, url, room, session }    │   a) createSession│
        │                                                │   b) dispatchAgent│
        │                                                │   c) mintToken    │
        │                                                └──────────────────┘
        │ 3. livekit-client.Room.connect(url, token)            │
        │                                                       │ dispatch
        ▼                                                       ▼
┌─────────────────────────── LiveKit Cloud Room ─────────────────────────────┐
│  browser participant (mic)  ◀──── WebRTC audio ────▶  agent (STT/LLM/TTS)  │
└────────────────────────────────────────────────────────────────────────────┘
```

### `POST /api/agents/:id/browser-call`

Permission: `agents:activate` — same as outbound calls. Returns 201 with:

```json
{
  "token": "<short-lived JWT (10 min)>",
  "url": "wss://my-project.livekit.cloud",
  "roomName": "browser-<nanoid>",
  "sessionId": "<uuid>",
  "dispatchId": "<livekit-dispatch-id>"
}
```

Validations (all 400 on failure):
- Agent is `isActive`
- `modality === "voice"` and `agentPlatform === "livekit"`
- `metadata.livekit.url` and `metadata.livekit.agentName` are set
- `secrets.livekit_api_key` and `secrets.livekit_api_secret` resolve in the vault

### Token grant

Minted via `livekit-server-sdk`'s `AccessToken`:

| Field          | Value                                    |
|----------------|------------------------------------------|
| identity       | caller-supplied or random `web-<nanoid>` |
| room           | `browser-<nanoid>`                       |
| roomJoin       | true                                     |
| canPublish     | true (microphone)                        |
| canSubscribe   | true (agent audio)                       |
| canPublishData | true (data channel for future RPC)       |
| ttl            | 10 minutes                               |

No room admin privileges. No ability to join other rooms.

### Dispatch metadata — prompt override

The key reason this loop is tight: the API passes the agent's latest `compiledInstructions` as the `instructions` field on dispatch metadata:

```json
{
  "session_id": "<uuid>",
  "user_identifier": "<web-identity>",
  "name": "<display-name>",
  "instructions": "<agent.compiledInstructions>"
}
```

The Python agent (`examples/agents/livekit-agent/src/agent.py`) reads `instructions` from dispatch metadata and passes it to `BuildProAgent(instructions_override=...)`. When the override is present, it replaces the compiled-in default system prompt for the session. This means the admin can iterate on prompts without redeploying the worker — **recompile → click Test → hear the change**.

Empty / missing overrides fall back to the built-in prompt (verified by unit tests).

### UI: `BrowserCallDialog`

Thin wrapper around `livekit-client` (same SDK that powers `meet.livekit.io`):

1. `api.post('agents/:id/browser-call')` → get `{ token, url, ... }`
2. `new Room()` → wire `Connected` / `Disconnected` / `TrackSubscribed` events
3. `room.connect(url, token)` — WebRTC handshake
4. `room.localParticipant.setMicrophoneEnabled(true)` — mic on
5. On `TrackSubscribed` (agent audio), `track.attach(<audio>)` for playback
6. **Mute / Unmute** and **End Call** (calls `room.disconnect()`)

All orchestration happens client-side once the token is issued. No server-side WebRTC.

### Why this works for "deployed" agents

The existing LiveKit outbound infrastructure (ADR-011) already handles deployed workers. `dispatchAgentToRoom` uses the LiveKit `AgentDispatchClient`, which routes the job to any worker registered with the matching `agent_name`. The deployed worker picks up the dispatch, joins the room, reads the metadata (including the prompt override), and the browser joins the same room. No agent code changes are required after deploy — just recompile the prompt.

## Alternatives Considered

- **Reuse `POST /agents/:id/outbound-call` and dial the browser via SIP** — rejected. Adds PSTN cost, latency, and requires phone numbers for testing.
- **Run the worker locally via `make lk-agent-dev`** — rejected as the primary path. Still supported for development, but doesn't match the goal of testing the deployed worker + deployed prompt.
- **Build the dialog on top of `@livekit/components-react`** — considered. The higher-level components offer prebuilt UI (audio visualizer, participant tiles). For the POC, the lower-level `livekit-client` keeps the bundle smaller and matches our "Atmospheric Dark" design system without fighting component styles. Upgrading to the components library is a straightforward follow-up once we want waveforms / multi-participant UIs.
- **Embed a direct prompt override in the UI session** — rejected. Overriding via dispatch metadata keeps the prompt server-authoritative (the UI never sees / edits the raw prompt) and means the eval harness + outbound calls can use the same mechanism in the future.

## Consequences

### Positive
- Iteration loop collapses from minutes (phone dial / local dev) to seconds (compile → click)
- No new services, credentials, or infrastructure — reuses ADR-011's per-agent LiveKit config
- Prompt override is opt-in: existing outbound calls and SIP flows are unaffected
- Session / transcript / analytics pipeline works identically for browser test calls
- Tests are isolated: `generateBrowserAccessToken` is a pure function (unit-tested); dispatch is mocked in integration tests

### Negative
- The browser caller's identity is weakly authenticated — the token is minted after the API's JWT auth, but anyone who captures the token can join the room until it expires. Mitigated by 10-minute TTL and room-scoped grants.
- Prompt override is currently all-or-nothing — a non-empty `instructions` value replaces the whole system prompt. Finer-grained merging (e.g. "append tool list") is deferred.
- The dialog doesn't yet render live transcript / tool-call events. The LiveKit data channel grant (`canPublishData: true`) is reserved for that follow-up.

### Future Work
- Stream transcript + tool call events from the agent to the browser via LiveKit data channels, rendered live in the dialog
- Allow overriding the user identity with a dashboard user email so sessions attribute correctly (today: random `web-<nanoid>`)
- Generalise the instruction override into a typed `RuntimeConfig` metadata contract shared by browser, SIP, and eval dispatches
- Add a connection-quality indicator and jitter buffer stats for debugging bad networks
