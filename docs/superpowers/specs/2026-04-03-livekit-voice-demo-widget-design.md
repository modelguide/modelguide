# LiveKit Voice Demo Widget — Design Spec

**Date:** 2026-04-03
**Status:** Draft
**Author:** Pablo + Claude

## Summary

Add an interactive voice demo widget to the ModelGuide marketing website ([modelguide/website](https://github.com/modelguide/website)). Visitors click "Talk to agent" on the Retail vertical accordion, a voice session starts with the BuildPro "Sam" agent running on LiveKit Cloud, and they get a 2-minute hands-on demo. No signup, no auth — just click and talk.

## Goals

- Let prospects experience the voice agent before booking a call
- Keep it dead simple: one button, one orb, one voice conversation
- Reuse the existing `buildpro-sam` agent and ModelGuide session infrastructure — zero agent-side changes
- Rate-limit to control cost; funnel users to founders calendar after the demo

## Non-Goals

- Transcript display in the widget
- Video or screen share
- Auth or signup gate
- MG API changes (token endpoint for dashboard calling is a future task)
- Analytics beyond what MG sessions already capture

---

## Architecture

```
[Website (Vercel)]                [LiveKit Cloud]              [MG API]
       |                                |                         |
  1. User clicks "Talk to agent"        |                         |
  2. POST /api/livekit-token  --------->|                         |
     (Next.js API route)                |                         |
  3. Returns { token, wsUrl }           |                         |
  4. Client connects to room  --------->|                         |
  5. LiveKit dispatches buildpro-sam    |                         |
       |                           Agent joins room               |
       |                                |--- create_session() --->|
       |<--- voice conversation ------->|                         |
       |                                |--- post_transcript() -->|
  6. 2-min timer expires                |                         |
  7. Client disconnects       --------->|                         |
       |                           Agent cleans up, marks session |
  8. Widget shows CTA                   |                         |
```

### Components

**Website (Vercel) — 3 new files, 1 modified:**

| File | Type | Purpose |
|------|------|---------|
| `app/api/livekit-token/route.ts` | API route | Token generation + IP rate limiting |
| `components/voice-demo.tsx` | Client component | LiveKit room connection, timer, state machine, controls |
| `components/voice-orb.tsx` | Client component | Animated SVG/canvas orb driven by audio amplitude |
| `app/page.tsx` | Modified | Replace disabled Retail button with live widget trigger, open Retail accordion by default |

**Agent (LiveKit Cloud) — no changes:**

The `buildpro-sam` agent handles demo participants identically to any WebRTC participant. It creates an MG session using `config.USER_EMAIL` (defaults to `"voice-caller"`), runs the conversation, posts the transcript, and marks the session complete on disconnect. Demo sessions are identifiable by their room name prefix `demo-` (visible in LiveKit Cloud dashboard and agent logs).

**MG API — no changes:**

Receives session and transcript data from the agent as usual.

---

## Token Endpoint

### `POST /api/livekit-token`

**Location:** `app/api/livekit-token/route.ts` (Next.js API route, runs on Vercel serverless)

**Request body:** None required. Optionally `{ identity?: string }`.

**Response (200):**
```json
{
  "token": "<jwt>",
  "wsUrl": "wss://modelguide-yxrkr4h6.livekit.cloud"
}
```

**Response (429):**
```json
{
  "error": "rate_limited",
  "message": "You've used all your demo sessions this hour."
}
```

**Logic:**
1. Extract client IP from `x-forwarded-for` header
2. Check rate limit via Vercel KV: max 5 sessions per IP per rolling hour
3. Generate identity: `demo-guest-{nanoid(8)}`
4. Generate room name: `demo-{nanoid(8)}`
5. Create `AccessToken` (from `livekit-server-sdk`) with:
   - Identity: the generated guest identity
   - Name: `"Guest"` (display name — avoids agent greeting with raw identity string)
   - Room: the generated room name
   - Grant: `{ roomJoin: true, room: roomName }`
   - `roomConfig` with `RoomAgentDispatch` (from `@livekit/protocol`): `{ agentName: "buildpro-sam" }`
   - TTL: 180 seconds (3 minutes — covers mic permission prompt, connection setup, agent cold start, plus the full 2-min conversation)
6. Increment rate limit counter in Vercel KV
7. Return token + wsUrl

**Rate limiting:**
- **Storage:** Vercel KV (Redis) — hard requirement, not optional
- Key: `demo-rate:{ip}`, value: list of timestamps, TTL: 1 hour
- Check: filter timestamps within last hour, reject if count >= 5
- For local dev: in-memory Map fallback (acceptable since it's single-process)

**Environment variables (Vercel):**
- `LIVEKIT_URL` — e.g., `wss://modelguide-yxrkr4h6.livekit.cloud`
- `LIVEKIT_API_KEY` — from LiveKit Cloud project
- `LIVEKIT_API_SECRET` — from LiveKit Cloud project
- `KV_REST_API_URL` — Vercel KV connection (auto-set when KV is linked)
- `KV_REST_API_TOKEN` — Vercel KV token (auto-set when KV is linked)

---

## Voice Demo Widget

### State Machine

```
IDLE → CONNECTING → CONNECTED → ENDING → ENDED
                 ↘                           ↗
                  ERROR ────────────────────→
                                    RATE_LIMITED
```

| State | Trigger | UI |
|-------|---------|-----|
| `IDLE` | Initial / after "Try again" | "Talk to agent →" button in accordion |
| `CONNECTING` | Button click | Button disabled, "Connecting..." text, orb fades in with heartbeat pulse. 15-second timeout — if agent doesn't join within 15s, transition to `ERROR`. |
| `CONNECTED` | Room connected + agent joined (detected via `participant.kind === ParticipantKind.AGENT`) | Orb animates with audio, timer counting up, mic + end buttons visible |
| `ENDING` | Timer hits 2:00 or user clicks end | Room disconnects, orb contracts to dot |
| `ENDED` | Disconnect confirmed | CTA: "Liked what you heard? →" typed out, link to founders calendar, "Try again" button |
| `ERROR` | Token fetch fails (non-429), WebSocket error, agent join timeout | "Something went wrong. Try again?" with retry button |
| `RATE_LIMITED` | Token endpoint returns 429 | "You've used all demo sessions. Want to see what Sam can really do? →" + founders calendar link |

### Component Hierarchy

The widget must wrap interactive elements in `<LiveKitRoom>` from `@livekit/components-react`:

```tsx
<VoiceDemo>                          {/* state machine, token fetch, timer */}
  {state === "IDLE" && <button>Talk to agent →</button>}
  {(state === "CONNECTING" || state === "CONNECTED") && (
    <LiveKitRoom                     {/* provides room context for hooks */}
      serverUrl={wsUrl}
      token={token}
      connect={true}
      audio={true}
    >
      <RoomAudioRenderer />          {/* plays agent audio */}
      <VoiceOrb />                   {/* uses useVoiceAssistant/useTrackVolume */}
      <Controls />                   {/* mic toggle, end, timer */}
    </LiveKitRoom>
  )}
  {state === "ENDED" && <EndCTA />}
  {state === "ERROR" && <ErrorRetry />}
  {state === "RATE_LIMITED" && <RateLimitCTA />}
</VoiceDemo>
```

### Timer Behavior

- Starts counting from `0:00` when state enters `CONNECTED`
- Displayed as `M:SS` in `JetBrains Mono`, small, below the orb
- At `1:50`: no visible UI change (stretch goal for v2: nudge agent to wrap up)
- At `2:00`: trigger transition to `ENDING`, disconnect the room

### Controls

Minimal, appearing below the orb when `CONNECTED`:

- **Mic toggle** — mute/unmute, ghost button style, `aria-label="Mute microphone"` / `"Unmute microphone"`
- **End call** — ghost button, ends session early, `aria-label="End call"`
- **Timer** — `<time>` element with `aria-live="off"` (visual only, not announced)

### Mic Permission

Browser mic permission is requested when the LiveKit room connects (`audio={true}`). If denied, transition to `ERROR` with message: "Mic access is needed to talk to Sam." and a retry option.

### Accessibility

- State changes announced via `aria-live="polite"` region: "Connecting...", "Connected. Sam is listening.", "Session ended."
- Mic toggle and end button have descriptive `aria-label` attributes
- Timer uses `<time>` element
- All interactive elements are keyboard-focusable

---

## Voice Orb

The visual centerpiece. A glowing orb that reacts to audio.

### Visual Design

- **Shape:** Circle, ~120px diameter on desktop, ~90px on mobile
- **Color:** `--accent` (#f97316) with a soft radial glow
- **Background:** Inherits page `--paper` (#f7f4ee) — no card or container border
- **Glow:** Soft box-shadow or radial gradient that pulses with audio amplitude

### Animation States

| Agent State | Orb Behavior |
|-------------|-------------|
| Connecting | Gentle heartbeat pulse (scale 1.0 → 1.05, ~1.5s cycle) |
| Agent speaking | Expands/contracts with audio amplitude (scale 1.0 → 1.3 range), glow intensifies |
| User speaking (agent listening) | Contracts slightly (scale ~0.9), subtle ring appears around orb |
| Processing (agent thinking) | Slow rotation or shimmer effect |
| Session ending | Contracts to a dot (scale → 0.1), fades out |

### `prefers-reduced-motion`

When the user has reduced motion enabled, disable all scale/pulse/shimmer animations. Use color-only state changes instead:
- Connecting: static orb, slightly dimmer
- Speaking: glow brightens (no scale)
- Listening: glow dims
- Ending: fade to transparent

### Audio Amplitude Implementation

Use `useVoiceAssistant()` to get the agent's audio track, then either:
- `useTrackVolume(agentTrack)` for a single normalized amplitude value (0-1) — simplest, maps directly to orb scale
- Or raw `AudioContext.analyser` on the track's `MediaStream` for finer control

Avoid `useAudioWaveform` — it returns an array of bar values designed for bar visualizers, not a single amplitude. The mapping from bars to a single orb scale adds unnecessary complexity.

Drive orb scale/glow via CSS custom properties updated per animation frame:
```css
.orb {
  transform: scale(var(--orb-scale, 1));
  box-shadow: 0 0 calc(var(--orb-glow, 20) * 1px) var(--accent);
}
```

SVG circle with CSS transforms preferred over canvas for simplicity. Canvas only if SVG performance is insufficient.

---

## Integration with Homepage

### Current State (Retail accordion)

```tsx
<button type="button" disabled className={styles.inactiveButton}>
  Talk to agent →
</button>
```

The Retail vertical is the 4th accordion item (index 3), currently closed by default (Insurance at index 0 opens by default).

### New State

1. **Open Retail by default** — change `open={index === 0}` to `open={index === 0 || vertical.title === "Retail"}` so the demo is visible on page load.

2. **Replace the Retail button** with the `VoiceDemo` component:

```tsx
{vertical.title === "Retail" ? (
  <VoiceDemo />
) : (
  <button type="button" disabled className={styles.inactiveButton}>
    Talk to agent →
  </button>
)}
```

The `VoiceDemo` component renders:
- In `IDLE` state: a styled button matching the existing button appearance but enabled and clickable
- In all other states: the orb + controls + timer below the accordion content

The widget expands the accordion body when active. No modal, no overlay.

---

## Dependencies

### New npm packages for `modelguide/website`:

| Package | Purpose |
|---------|---------|
| `@livekit/components-react` | React hooks + components for LiveKit rooms |
| `livekit-client` | WebRTC client SDK (peer dep of components-react) |
| `livekit-server-sdk` | Server-side token generation (API route only) |
| `@livekit/protocol` | `RoomAgentDispatch` + `RoomConfiguration` for agent dispatch in token |
| `nanoid` | Short unique IDs for room names and guest identities |
| `@vercel/kv` | Vercel KV client for rate limiting |

Note: `@livekit/components-styles` is not needed — we use fully custom styling for the orb widget.

### Environment Variables (Vercel)

| Variable | Value |
|----------|-------|
| `LIVEKIT_URL` | `wss://modelguide-yxrkr4h6.livekit.cloud` |
| `LIVEKIT_API_KEY` | From LiveKit Cloud project settings |
| `LIVEKIT_API_SECRET` | From LiveKit Cloud project settings |
| `KV_REST_API_URL` | Auto-set when Vercel KV is linked |
| `KV_REST_API_TOKEN` | Auto-set when Vercel KV is linked |

---

## Rate Limiting

- **Limit:** 5 sessions per IP per rolling hour
- **Enforcement:** Token endpoint (`/api/livekit-token`)
- **Storage:** Vercel KV (Redis) — required for production (in-memory is no-op on serverless)
- **Local dev fallback:** In-memory Map (single-process, acceptable for development)
- **UI after limit reached:** Widget shows "You've used all demo sessions. Want to see what Sam can really do?" with CTA to founders calendar

---

## Cost & Abuse Considerations

- **Per-session cost:** ~$0.10-0.15/min for LLM + STT + TTS = ~$0.20-0.30 per 2-min demo session
- **Max cost per IP per hour:** 5 sessions x $0.30 = $1.50
- **Token TTL of 180s** is the server-side safety net — even if client JS fails, LiveKit kills the connection after 3 minutes
- **No auth required** — acceptable for a marketing demo with these cost constraints
- **Monitoring:** Demo sessions visible via room name prefix `demo-` in LiveKit Cloud dashboard and agent logs

---

## Testing Requirements

Per the LiveKit agents skill, every implementation must include tests:

1. **Token endpoint tests:**
   - Generates valid token with correct agent dispatch config
   - Sets participant name to "Guest"
   - Rate limiting rejects after 5 requests from same IP
   - Returns correct response shape (200 and 429 cases)
   - Handles missing IP header gracefully

2. **Widget component tests:**
   - State machine transitions (IDLE → CONNECTING → CONNECTED → ENDING → ENDED)
   - ERROR state on connection failure
   - ERROR state on agent join timeout (15s)
   - Timer counts up and triggers disconnect at 2:00
   - Rate limit state shown on 429 response
   - Mic permission denial handled gracefully

3. **Orb animation tests:**
   - Renders without crashing
   - Respects `prefers-reduced-motion`
   - Responds to amplitude changes (visual regression optional)

---

## Open Questions

1. **Agent wrap-up nudge at 1:50** — Worth implementing for v1 or defer? The agent's existing auto-hangup logic may handle this naturally if the user says goodbye.
2. **Mobile experience** — The orb + controls should work on mobile but may need specific touch/mic testing on iOS Safari (known WebRTC quirks).
3. **nanoid alphabet** — Confirm default nanoid characters are all valid LiveKit room name characters. If not, use `nanoid/url` or a custom alphabet.
