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
| `components/voice-demo.tsx` | Client component | LiveKit room, timer, state machine, controls |
| `components/voice-orb.tsx` | Client component | Animated SVG/canvas orb driven by audio data |
| `app/page.tsx` | Modified | Replace disabled Retail button with live widget trigger |

**Agent (LiveKit Cloud) — no changes:**

The `buildpro-sam` agent handles demo participants identically to any WebRTC participant. It creates an MG session using the participant identity (`demo-guest-{nanoid}`), runs the conversation, posts the transcript, and marks the session complete on disconnect.

**MG API — no changes:**

Receives session and transcript data from the agent as usual. Demo sessions are identifiable in the dashboard by the `demo-guest-` identity prefix.

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
2. Check rate limit: max 5 sessions per IP per rolling hour
3. Generate identity: `demo-guest-{nanoid(8)}`
4. Generate room name: `demo-{nanoid(8)}`
5. Create `AccessToken` with:
   - Identity: the generated guest identity
   - Room: the generated room name
   - Grant: `{ roomJoin: true, room: roomName }`
   - `roomConfig` with `RoomAgentDispatch({ agentName: "buildpro-sam" })`
   - TTL: 130 seconds (2 min + 10s buffer)
6. Return token + wsUrl

**Rate limiting approach:**
- Vercel KV (Redis) if available, otherwise in-memory Map as fallback
- Key: `demo-rate:{ip}`, value: list of timestamps, TTL: 1 hour
- Check: filter timestamps within last hour, reject if count >= 5

**Environment variables (Vercel):**
- `LIVEKIT_URL` — e.g., `wss://modelguide-yxrkr4h6.livekit.cloud`
- `LIVEKIT_API_KEY` — from LiveKit Cloud project
- `LIVEKIT_API_SECRET` — from LiveKit Cloud project

---

## Voice Demo Widget

### State Machine

```
IDLE → CONNECTING → CONNECTED → ENDING → ENDED → RATE_LIMITED
```

| State | Trigger | UI |
|-------|---------|-----|
| `IDLE` | Initial / after "Try again" | "Talk to agent →" button in accordion |
| `CONNECTING` | Button click | Button disabled, "Connecting..." text, orb fades in with heartbeat pulse |
| `CONNECTED` | Room connected + agent joined | Orb animates with audio, timer counting up, mic + end buttons visible |
| `ENDING` | Timer hits 2:00 or user clicks end | Room disconnects, orb contracts to dot |
| `ENDED` | Disconnect confirmed | CTA: "Liked what you heard? →" typed out, link to founders calendar, "Try again" button |
| `RATE_LIMITED` | Token endpoint returns 429 | "You've used all demo sessions. Want to see what Sam can really do? →" + founders calendar link |

### Timer Behavior

- Starts counting from `0:00` when state enters `CONNECTED`
- Displayed as `M:SS` in `JetBrains Mono`, small, below the orb
- At `1:50`: no visible UI change, but optionally send a data message to the agent to wrap up (stretch goal — not required for v1)
- At `2:00`: trigger transition to `ENDING`, disconnect the room

### Controls

Minimal, appearing below the orb when `CONNECTED`:

- **Mic toggle** — mute/unmute, ghost button style
- **End call** — ghost button, ends session early
- **Timer** — passive display, not a button

### Mic Permission

Browser mic permission is requested when the LiveKit room connects (standard browser prompt). If denied, show a brief message: "Mic access is needed to talk to Sam." with a retry option.

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

### Implementation

- Use `useAudioWaveform` hook from `@livekit/components-react` to get amplitude data
- Drive orb scale/glow via CSS custom properties updated per animation frame
- SVG circle with CSS transforms and transitions, or canvas for smoother animation
- Prefer CSS animations where possible for performance (GPU-accelerated transforms)

---

## Integration with Homepage

### Current State (Retail accordion)

```tsx
<button type="button" disabled className={styles.inactiveButton}>
  Talk to agent →
</button>
```

### New State

Replace the Retail accordion's disabled button with the `VoiceDemo` component:

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
- In `IDLE` state: a styled button matching the existing `inactiveButton` appearance but enabled and clickable
- In all other states: the orb + controls + timer below the accordion content

The widget expands the accordion body when active. No modal, no overlay.

---

## Dependencies

### New npm packages for `modelguide/website`:

| Package | Purpose |
|---------|---------|
| `@livekit/components-react` | React hooks + components for LiveKit rooms |
| `@livekit/components-styles` | Default styles (we'll override most) |
| `livekit-client` | WebRTC client SDK |
| `livekit-server-sdk` | Server-side token generation (used in API route only) |
| `nanoid` | Short unique IDs for room names and guest identities |

### Environment Variables (Vercel)

| Variable | Value |
|----------|-------|
| `LIVEKIT_URL` | `wss://modelguide-yxrkr4h6.livekit.cloud` |
| `LIVEKIT_API_KEY` | From LiveKit Cloud project settings |
| `LIVEKIT_API_SECRET` | From LiveKit Cloud project settings |

---

## Rate Limiting

- **Limit:** 5 sessions per IP per rolling hour
- **Enforcement:** Token endpoint (`/api/livekit-token`)
- **Storage:** Vercel KV (Redis) preferred; in-memory Map fallback for local dev
- **UI after limit reached:** Widget shows "You've used all demo sessions. Want to see what Sam can really do?" with CTA to founders calendar

---

## Cost & Abuse Considerations

- **Per-session cost:** ~$0.10-0.15/min for LLM + STT + TTS = ~$0.20-0.30 per 2-min demo session
- **Max cost per IP per hour:** 5 sessions x $0.30 = $1.50
- **Token TTL of 130s** is the server-side safety net — even if client JS fails, LiveKit kills the connection
- **No auth required** — acceptable for a marketing demo with these cost constraints
- **Monitoring:** Demo sessions visible in MG dashboard via `demo-guest-` prefix

---

## Testing Requirements

Per the LiveKit agents skill, every implementation must include tests:

1. **Token endpoint tests:**
   - Generates valid token with correct agent dispatch
   - Rate limiting rejects after 5 requests
   - Returns correct response shape

2. **Widget component tests:**
   - State machine transitions (IDLE → CONNECTING → CONNECTED → ENDING → ENDED)
   - Timer counts up and triggers disconnect at 2:00
   - Rate limit state shown on 429 response
   - Mic permission denial handled gracefully

3. **Orb animation tests:**
   - Renders without crashing
   - Responds to audio amplitude changes (visual regression optional)

---

## Open Questions

1. **Vercel KV availability** — Does the website project have Vercel KV set up? If not, in-memory rate limiting works for v1 (stateless functions reset, so it's leaky — but acceptable for a marketing demo).
2. **Agent wrap-up nudge at 1:50** — Worth implementing for v1 or defer? The agent's existing auto-hangup logic may handle this naturally if the user says goodbye.
3. **Mobile experience** — The orb + controls should work on mobile but may need specific touch/mic testing on iOS Safari (known WebRTC quirks).
