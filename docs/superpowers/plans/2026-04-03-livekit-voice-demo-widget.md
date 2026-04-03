# LiveKit Voice Demo Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Talk to agent" voice demo widget to the ModelGuide marketing website homepage, letting visitors have a 2-minute voice conversation with BuildPro Sam.

**Architecture:** Next.js API route generates LiveKit tokens with agent dispatch. Client-side React widget connects to LiveKit room, renders an animated orb driven by audio amplitude, enforces a 2-minute session cap. Rate limiting via Vercel KV (per-IP + global daily cap).

**Tech Stack:** Next.js 15, React 19, CSS Modules, LiveKit Components React, LiveKit Server SDK, Vercel KV, Playwright

**Spec:** `docs/superpowers/specs/2026-04-03-livekit-voice-demo-widget-design.md`

**Repo:** `~/Projects/modelguide/mg-repos/website` (branch: `feat/voice-demo`)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/api/livekit-token/route.ts` | Create | Token generation, rate limiting (per-IP + global daily) |
| `lib/rate-limit.ts` | Create | Vercel KV rate limit logic, in-memory fallback for local dev |
| `components/voice-demo.tsx` | Create | Widget state machine, LiveKit room connection, timer, controls |
| `components/voice-demo.module.css` | Create | Widget styles (controls, timer, CTA states, layout) |
| `components/voice-orb.tsx` | Create | Animated SVG orb driven by audio amplitude |
| `components/voice-orb.module.css` | Create | Orb styles, glow, animations, reduced-motion |
| `app/page.tsx` | Modify | Import VoiceDemo, replace Retail disabled button, open Retail accordion |
| `app/page.module.css` | Modify | Add styles for active accordion demo state if needed |
| `tests/voice-demo.spec.ts` | Create | E2E tests for widget states, rate limiting, timer |
| `package.json` | Modify | Add LiveKit + Vercel KV dependencies |

---

## Task 0: Project Setup

**Files:**
- Modify: `package.json`
- Create: branch `feat/voice-demo`

- [ ] **Step 1: Create feature branch**

```bash
cd ~/Projects/modelguide/mg-repos/website
git checkout main
git pull origin main
git checkout -b feat/voice-demo
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @livekit/components-react livekit-client livekit-server-sdk @livekit/protocol nanoid @vercel/kv
```

- [ ] **Step 3: Add .env.local to .gitignore**

Next.js convention but not in this project's `.gitignore`:

```bash
echo -e "\n# Local env files\n.env.local\n.env*.local" >> .gitignore
```

- [ ] **Step 4: Create .env.local with placeholder values**

```env
LIVEKIT_URL=wss://modelguide-yxrkr4h6.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
DEMO_DAILY_LIMIT=100
```

- [ ] **Step 5: Verify the site still builds**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add LiveKit and Vercel KV dependencies for voice demo"
```

---

## Task 1: Rate Limiting Module

**Files:**
- Create: `lib/rate-limit.ts`

- [ ] **Step 1: Write rate-limit.ts**

```typescript
import { kv } from "@vercel/kv";

interface RateLimitResult {
  allowed: boolean;
  reason?: "ip_limit" | "global_limit";
}

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const GLOBAL_DAILY_LIMIT = parseInt(process.env.DEMO_DAILY_LIMIT || "100", 10);

// In-memory fallback for local dev (no Vercel KV)
const memoryStore = new Map<string, number[]>();
let memoryGlobalCount = { date: "", count: 0 };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function checkWithKV(ip: string): Promise<RateLimitResult> {
  const today = todayKey();
  const globalKey = `demo-global:${today}`;
  const ipKey = `demo-rate:${ip}`;

  // Check global daily cap
  const globalCount = (await kv.get<number>(globalKey)) ?? 0;
  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    return { allowed: false, reason: "global_limit" };
  }

  // Check per-IP limit
  const timestamps: number[] = (await kv.get<number[]>(ipKey)) ?? [];
  const now = Date.now();
  const recent = timestamps.filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_LIMIT) {
    return { allowed: false, reason: "ip_limit" };
  }

  // Record this session
  // Note: check-then-increment is not atomic — concurrent requests from the same IP
  // can briefly exceed the limit. Acceptable for a marketing demo with low traffic.
  recent.push(now);
  await kv.set(ipKey, recent, { ex: 3600 }); // TTL 1 hour
  await kv.incr(globalKey);
  await kv.expire(globalKey, 86400); // TTL 24 hours

  return { allowed: true };
}

function checkWithMemory(ip: string): RateLimitResult {
  const today = todayKey();

  // Reset global counter on new day
  if (memoryGlobalCount.date !== today) {
    memoryGlobalCount = { date: today, count: 0 };
  }
  if (memoryGlobalCount.count >= GLOBAL_DAILY_LIMIT) {
    return { allowed: false, reason: "global_limit" };
  }

  // Check per-IP
  const now = Date.now();
  const timestamps = memoryStore.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_LIMIT) {
    return { allowed: false, reason: "ip_limit" };
  }

  recent.push(now);
  memoryStore.set(ip, recent);
  memoryGlobalCount.count++;

  return { allowed: true };
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  try {
    return await checkWithKV(ip);
  } catch {
    // Vercel KV not available (local dev) — fall back to in-memory
    return checkWithMemory(ip);
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add lib/rate-limit.ts
git commit -m "feat: add rate limiting module with Vercel KV and in-memory fallback"
```

---

## Task 2: Token Endpoint

**Files:**
- Create: `app/api/livekit-token/route.ts`

- [ ] **Step 1: Write the token endpoint**

```typescript
import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { nanoid } from "nanoid";
import { checkRateLimit } from "@/lib/rate-limit";

const TOKEN_TTL_SECONDS = 180; // 3 minutes

export async function POST(request: Request) {
  // Read env vars at runtime (not top-level) to avoid build-time crashes
  // when LiveKit credentials aren't available during `next build`
  const LIVEKIT_URL = process.env.LIVEKIT_URL;
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const { allowed, reason } = await checkRateLimit(ip);

  if (!allowed) {
    const message =
      reason === "global_limit"
        ? "We're popular today! All demo slots are taken. Book a call instead."
        : "You've used all your demo sessions this hour.";

    return Response.json({ error: "rate_limited", reason, message }, { status: 429 });
  }

  const identity = `demo-guest-${nanoid(8)}`;
  const roomName = `demo-${nanoid(8)}`;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: "Guest",
    ttl: TOKEN_TTL_SECONDS,
  });

  at.addGrant({ roomJoin: true, room: roomName });
  at.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: "buildpro-sam" })],
  });

  const token = await at.toJwt();

  return Response.json({ token, wsUrl: LIVEKIT_URL });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors. Note: If `AccessToken` API differs from what's shown, consult `livekit-server-sdk` types or LiveKit docs. The `roomConfig` property and `RoomAgentDispatch` import must be verified against the installed SDK version.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
# In another terminal:
curl -X POST http://localhost:3000/api/livekit-token | jq .
```

Expected: `{ "token": "eyJ...", "wsUrl": "wss://..." }`

- [ ] **Step 4: Commit**

```bash
git add app/api/livekit-token/route.ts
git commit -m "feat: add LiveKit token endpoint with agent dispatch and rate limiting"
```

---

## Task 3: Voice Orb Component

**Files:**
- Create: `components/voice-orb.tsx`
- Create: `components/voice-orb.module.css`

- [ ] **Step 1: Write voice-orb.module.css**

```css
.orbContainer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 0;
}

.orb {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--accent);
  transform: scale(var(--orb-scale, 1));
  box-shadow: 0 0 calc(var(--orb-glow, 20) * 1px) rgba(249, 115, 22, 0.5);
  transition: box-shadow 0.1s ease;
  will-change: transform;
}

/* Heartbeat pulse for connecting state */
.orbConnecting {
  animation: heartbeat 1.5s ease-in-out infinite;
}

@keyframes heartbeat {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

/* Listening state: subtle ring */
.orbListening {
  box-shadow:
    0 0 calc(var(--orb-glow, 15) * 1px) rgba(249, 115, 22, 0.4),
    0 0 0 3px rgba(249, 115, 22, 0.2);
}

/* Ending: shrink to dot */
.orbEnding {
  animation: shrinkToDot 0.6s ease-in forwards;
}

@keyframes shrinkToDot {
  to {
    transform: scale(0.1);
    opacity: 0;
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .orb {
    transition: none;
    animation: none;
  }

  .orbConnecting {
    animation: none;
    opacity: 0.7;
  }

  .orbEnding {
    animation: fadeOnly 0.6s ease-in forwards;
  }

  @keyframes fadeOnly {
    to { opacity: 0; }
  }
}

@media (max-width: 720px) {
  .orb {
    width: 90px;
    height: 90px;
  }
}
```

- [ ] **Step 2: Write voice-orb.tsx**

```tsx
"use client";

import { useEffect, useRef, useCallback } from "react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import styles from "./voice-orb.module.css";

type OrbState = "connecting" | "speaking" | "listening" | "ending";

interface VoiceOrbProps {
  state: OrbState;
  agentAudioTrack?: TrackReferenceOrPlaceholder;
}

export function VoiceOrb({ state, agentAudioTrack }: VoiceOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Set up AudioContext analyser when agent audio track changes
  useEffect(() => {
    if (!agentAudioTrack?.publication?.track) {
      analyserRef.current = null;
      return;
    }

    const mediaStream = agentAudioTrack.publication.track.mediaStream;
    if (!mediaStream) return;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

    return () => {
      audioCtx.close();
      analyserRef.current = null;
    };
  }, [agentAudioTrack?.publication?.track]);

  // Animation loop: drive orb scale from audio amplitude
  const animate = useCallback(() => {
    const orb = orbRef.current;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (orb && analyser && dataArray && state === "speaking") {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
      const normalized = avg / 255; // 0-1
      const scale = 1 + normalized * 0.3; // 1.0 - 1.3
      const glow = 20 + normalized * 40; // 20 - 60

      orb.style.setProperty("--orb-scale", String(scale));
      orb.style.setProperty("--orb-glow", String(glow));
    } else if (orb && state === "listening") {
      orb.style.setProperty("--orb-scale", "0.92");
      orb.style.setProperty("--orb-glow", "15");
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [state]);

  useEffect(() => {
    if (state === "speaking" || state === "listening") {
      rafRef.current = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(rafRef.current);
    }
  }, [state, animate]);

  const stateClass =
    state === "connecting"
      ? styles.orbConnecting
      : state === "listening"
        ? styles.orbListening
        : state === "ending"
          ? styles.orbEnding
          : "";

  return (
    <div className={styles.orbContainer}>
      <div
        ref={orbRef}
        className={`${styles.orb} ${stateClass}`}
        role="img"
        aria-label={
          state === "connecting"
            ? "Connecting to agent"
            : state === "speaking"
              ? "Agent is speaking"
              : state === "listening"
                ? "Agent is listening"
                : "Session ending"
        }
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors. The `TrackReferenceOrPlaceholder` import and `publication.track.mediaStream` access may need adjustment based on actual `@livekit/components-react` types — check the installed package types if compilation fails.

- [ ] **Step 4: Commit**

```bash
git add components/voice-orb.tsx components/voice-orb.module.css
git commit -m "feat: add voice orb component with audio-reactive animation"
```

---

## Task 4: Voice Demo Widget

**Files:**
- Create: `components/voice-demo.tsx`
- Create: `components/voice-demo.module.css`

- [ ] **Step 1: Write voice-demo.module.css**

```css
.widget {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.startButton {
  font-family: var(--font-sans);
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--accent);
  background: none;
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 0.5rem 1.2rem;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.startButton:hover {
  background: var(--accent);
  color: white;
}

.startButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.ghostButton {
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease;
}

.ghostButton:hover {
  color: var(--ink);
  border-color: var(--border-strong);
}

.ghostButtonActive {
  color: var(--accent);
  border-color: var(--accent);
}

.timer {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--muted);
  letter-spacing: 0.05em;
}

.statusText {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  letter-spacing: 0.04em;
  text-transform: lowercase;
}

.endState {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.ctaLink {
  font-family: var(--font-sans);
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--accent);
  text-decoration: none;
  transition: opacity 160ms ease;
}

.ctaLink:hover {
  opacity: 0.8;
}

.ctaSubtext {
  font-size: 0.78rem;
  color: var(--muted);
}

.retryButton {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.retryButton:hover {
  color: var(--ink);
}

/* Visually hidden but accessible */
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

- [ ] **Step 2: Write voice-demo.tsx**

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useVoiceAssistant,
  useRoomContext,
} from "@livekit/components-react";
import { RoomEvent, ParticipantKind } from "livekit-client";
import { siteConfig } from "@/lib/site-config";
import { VoiceOrb } from "./voice-orb";
import styles from "./voice-demo.module.css";

type WidgetState =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "ENDING"
  | "ENDED"
  | "ERROR"
  | "RATE_LIMITED";

const SESSION_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const AGENT_TIMEOUT_MS = 15_000; // 15 seconds

export function VoiceDemo() {
  const [state, setState] = useState<WidgetState>("IDLE");
  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [rateLimitMessage, setRateLimitMessage] = useState<string>("");

  const handleStart = useCallback(async () => {
    setState("CONNECTING");

    try {
      const res = await fetch("/api/livekit-token", { method: "POST" });

      if (res.status === 429) {
        const data = await res.json();
        setRateLimitMessage(data.message);
        setState("RATE_LIMITED");
        return;
      }

      if (!res.ok) {
        throw new Error(`Token request failed: ${res.status}`);
      }

      const data = await res.json();
      setToken(data.token);
      setWsUrl(data.wsUrl);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Connection failed");
      setState("ERROR");
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    setToken(null);
    setWsUrl(null);
    setState("ENDED");
  }, []);

  const handleRetry = useCallback(() => {
    setToken(null);
    setWsUrl(null);
    setErrorMessage("");
    setState("IDLE");
  }, []);

  return (
    <div className={styles.widget}>
      <div className={styles.srOnly} aria-live="polite">
        {state === "CONNECTING" && "Connecting to agent..."}
        {state === "CONNECTED" && "Connected. Sam is listening."}
        {state === "ENDED" && "Session ended."}
        {state === "ERROR" && `Error: ${errorMessage}`}
      </div>

      {state === "IDLE" && (
        <button className={styles.startButton} onClick={handleStart}>
          Talk to agent →
        </button>
      )}

      {(state === "CONNECTING" || state === "CONNECTED" || state === "ENDING") &&
        token &&
        wsUrl && (
          <LiveKitRoom
            serverUrl={wsUrl}
            token={token}
            connect={true}
            audio={true}
            onDisconnected={handleDisconnect}
            onError={(err) => {
              // Detect mic permission denial specifically
              const msg =
                err?.name === "NotAllowedError"
                  ? "Mic access is needed to talk to Sam."
                  : err?.message || "Connection error";
              setErrorMessage(msg);
              setState("ERROR");
            }}
          >
            <RoomAudioRenderer />
            <RoomContent
              state={state}
              setState={setState}
              onEnd={handleDisconnect}
            />
          </LiveKitRoom>
        )}

      {state === "ENDED" && (
        <div className={styles.endState}>
          <a
            href={siteConfig.foundersUrl}
            className={styles.ctaLink}
            target="_blank"
            rel="noreferrer"
          >
            Liked what you heard? →
          </a>
          <p className={styles.ctaSubtext}>Book a voice strategy session</p>
          <button className={styles.retryButton} onClick={handleRetry}>
            Try again
          </button>
        </div>
      )}

      {state === "ERROR" && (
        <div className={styles.endState}>
          <p className={styles.statusText}>{errorMessage || "Something went wrong."}</p>
          <button className={styles.retryButton} onClick={handleRetry}>
            Try again
          </button>
        </div>
      )}

      {state === "RATE_LIMITED" && (
        <div className={styles.endState}>
          <p className={styles.statusText}>{rateLimitMessage}</p>
          <a
            href={siteConfig.foundersUrl}
            className={styles.ctaLink}
            target="_blank"
            rel="noreferrer"
          >
            Talk to the founders →
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Inner component that runs inside <LiveKitRoom> and has access to room context.
 */
function RoomContent({
  state,
  setState,
  onEnd,
}: {
  state: WidgetState;
  setState: (s: WidgetState) => void;
  onEnd: () => void;
}) {
  const room = useRoomContext();
  const voiceAssistant = useVoiceAssistant();
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const agentTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Wait for agent to join, with timeout
  useEffect(() => {
    if (state !== "CONNECTING") return;

    const checkAgent = () => {
      for (const p of room.remoteParticipants.values()) {
        if (p.kind === ParticipantKind.AGENT) {
          setState("CONNECTED");
          return true;
        }
      }
      return false;
    };

    // Agent might already be there
    if (checkAgent()) return;

    const handleParticipantConnected = () => {
      checkAgent();
    };

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);

    // Timeout after 15 seconds
    agentTimeoutRef.current = setTimeout(() => {
      if (state === "CONNECTING") {
        room.disconnect();
        setState("ERROR");
      }
    }, AGENT_TIMEOUT_MS);

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      if (agentTimeoutRef.current) clearTimeout(agentTimeoutRef.current);
    };
  }, [state, room, setState]);

  // Session timer (counts up, disconnects at 2:00)
  useEffect(() => {
    if (state !== "CONNECTED") return;

    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= SESSION_DURATION_MS / 1000) {
          room.disconnect();
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, room]);

  const toggleMute = useCallback(() => {
    const localParticipant = room.localParticipant;
    const newMuted = !muted;
    localParticipant.setMicrophoneEnabled(!newMuted);
    setMuted(newMuted);
  }, [room, muted]);

  const handleEndCall = useCallback(() => {
    setState("ENDING");
    room.disconnect();
  }, [room, setState]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timerDisplay = `${minutes}:${String(seconds).padStart(2, "0")}`;

  // Determine orb state
  const orbState =
    state === "CONNECTING"
      ? "connecting"
      : state === "ENDING"
        ? "ending"
        : voiceAssistant.state === "speaking"
          ? "speaking"
          : "listening";

  return (
    <>
      <VoiceOrb state={orbState} agentAudioTrack={voiceAssistant.audioTrack} />

      {state === "CONNECTING" && (
        <p className={styles.statusText}>Connecting...</p>
      )}

      {state === "CONNECTED" && (
        <>
          <p className={styles.statusText}>
            {voiceAssistant.state === "speaking"
              ? "Sam is speaking"
              : "Sam is listening"}
          </p>
          <div className={styles.controls}>
            <button
              className={`${styles.ghostButton} ${muted ? styles.ghostButtonActive : ""}`}
              onClick={toggleMute}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <span role="timer" aria-live="off" className={styles.timer}>{timerDisplay}</span>
            <button
              className={styles.ghostButton}
              onClick={handleEndCall}
              aria-label="End call"
            >
              End
            </button>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

**IMPORTANT SDK verification (do this before writing code):**
- Check `node_modules/@livekit/components-react/dist/index.d.ts` for `useVoiceAssistant` return type — verify `state` enum values and `audioTrack` property name
- Check if `LiveKitRoom` has an `onError` prop — if not, handle errors via `room.on(RoomEvent.Disconnected, ...)` inside `RoomContent` instead
- Check `voiceAssistant.audioTrack` type — if it's not `TrackReferenceOrPlaceholder`, adjust the orb's audio analysis accordingly
- If any API differs, consult the LiveKit docs MCP server and adjust

- [ ] **Step 4: Commit**

```bash
git add components/voice-demo.tsx components/voice-demo.module.css
git commit -m "feat: add voice demo widget with state machine, timer, and controls"
```

---

## Task 5: Homepage Integration

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add VoiceDemo import and integrate into page**

At the top of `app/page.tsx`, add the import:

```typescript
import { VoiceDemo } from "@/components/voice-demo";
```

- [ ] **Step 2: Open Retail accordion by default**

In the accordion rendering, change the `open` prop:

```tsx
// Before:
<details key={vertical.title} className={styles.accordionItem} open={index === 0}>

// After:
<details key={vertical.title} className={styles.accordionItem} open={index === 0 || vertical.title === "Retail"}>
```

- [ ] **Step 3: Replace the Retail disabled button with VoiceDemo**

In the accordion body, replace the button:

```tsx
// Before:
<button
  type="button"
  disabled
  className={styles.inactiveButton}
  aria-label={`Talk to agent for ${vertical.title} coming soon`}
>
  Talk to agent →
</button>

// After:
{vertical.title === "Retail" ? (
  <VoiceDemo />
) : (
  <button
    type="button"
    disabled
    className={styles.inactiveButton}
    aria-label={`Talk to agent for ${vertical.title} coming soon`}
  >
    Talk to agent →
  </button>
)}
```

- [ ] **Step 4: Verify the site builds and renders**

```bash
npm run build
npm run dev
```

Open `http://localhost:3000` — the Retail accordion should be open with a "Talk to agent →" button that is clickable (not disabled).

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: integrate voice demo widget into homepage Retail accordion"
```

---

## Task 6: E2E Tests

**Files:**
- Create: `tests/voice-demo.spec.ts`

- [ ] **Step 1: Write E2E tests**

These tests verify widget behavior without connecting to a real LiveKit room. We mock the token endpoint to control the flow.

```typescript
import { test, expect } from "@playwright/test";

test.describe("Voice demo widget", () => {
  test("shows 'Talk to agent' button in Retail accordion", async ({ page }) => {
    await page.goto("/");

    // Retail accordion should be open
    const retailDetails = page.locator("details", { hasText: "Retail" });
    await expect(retailDetails).toHaveAttribute("open", "");

    // Button should be visible and clickable
    const talkButton = retailDetails.getByRole("button", { name: "Talk to agent →" });
    await expect(talkButton).toBeVisible();
    await expect(talkButton).toBeEnabled();
  });

  test("other verticals still have disabled buttons", async ({ page }) => {
    await page.goto("/");

    const insuranceDetails = page.locator("details", { hasText: "Insurance" });
    const disabledButton = insuranceDetails.getByRole("button", {
      name: /Talk to agent for Insurance/,
    });
    await expect(disabledButton).toBeDisabled();
  });

  test("shows rate limit message on 429 response", async ({ page }) => {
    // Mock the token endpoint to return 429
    await page.route("**/api/livekit-token", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "rate_limited",
          reason: "ip_limit",
          message: "You've used all your demo sessions this hour.",
        }),
      })
    );

    await page.goto("/");

    const retailDetails = page.locator("details", { hasText: "Retail" });
    const talkButton = retailDetails.getByRole("button", { name: "Talk to agent →" });
    await talkButton.click();

    await expect(page.getByText("You've used all your demo sessions")).toBeVisible();
    await expect(page.getByText("Talk to the founders")).toBeVisible();
  });

  test("shows error state on failed token request", async ({ page }) => {
    await page.route("**/api/livekit-token", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" })
    );

    await page.goto("/");

    const retailDetails = page.locator("details", { hasText: "Retail" });
    const talkButton = retailDetails.getByRole("button", { name: "Talk to agent →" });
    await talkButton.click();

    await expect(page.getByText("Try again")).toBeVisible();
  });

  test("shows global rate limit message", async ({ page }) => {
    await page.route("**/api/livekit-token", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "rate_limited",
          reason: "global_limit",
          message: "We're popular today! All demo slots are taken. Book a call instead.",
        }),
      })
    );

    await page.goto("/");

    const retailDetails = page.locator("details", { hasText: "Retail" });
    const talkButton = retailDetails.getByRole("button", { name: "Talk to agent →" });
    await talkButton.click();

    await expect(page.getByText("All demo slots are taken")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
npm run test:e2e
```

Expected: All tests pass. The tests that mock the token endpoint should work without LiveKit credentials. Note: the test server builds the site first (see playwright.config.ts), so `LIVEKIT_URL` etc. must be set in `.env.local` or the build may fail due to the `!` assertion in the token route. If this happens, add fallback defaults in the route or guard the env check behind a runtime check instead of top-level `!`.

- [ ] **Step 3: Commit**

```bash
git add tests/voice-demo.spec.ts
git commit -m "test: add E2E tests for voice demo widget states"
```

---

## Task 7: Lint, Build, and Final Verification

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: Clean build with no errors.

- [ ] **Step 3: Run all E2E tests (including existing site tests)**

```bash
npm run test:e2e
```

Expected: All tests pass (existing + new voice demo tests).

- [ ] **Step 4: Manual test with real credentials**

If LiveKit credentials are configured in `.env.local`:
1. Run `npm run dev`
2. Open `http://localhost:3000`
3. Scroll to Retail accordion (should be open)
4. Click "Talk to agent →"
5. Allow mic permission
6. Verify: orb appears, pulses while connecting, reacts to agent voice
7. Verify: timer counts up
8. Verify: mute/unmute works
9. Verify: "End" button disconnects and shows CTA
10. Verify: after 2 minutes, auto-disconnect + CTA

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address lint and build issues from final verification"
```

---

## Task 8: Vercel Setup Notes

These are manual steps for the deployer (not code tasks):

- [ ] **Step 1: Add Vercel KV to the website project**

In Vercel dashboard → website project → Storage → Create KV Database. Link it to the project. This auto-sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

- [ ] **Step 2: Add environment variables**

In Vercel dashboard → website project → Settings → Environment Variables:
- `LIVEKIT_URL` = `wss://modelguide-yxrkr4h6.livekit.cloud`
- `LIVEKIT_API_KEY` = (from LiveKit Cloud project)
- `LIVEKIT_API_SECRET` = (from LiveKit Cloud project)
- `DEMO_DAILY_LIMIT` = `100`

- [ ] **Step 3: Enable Vercel Spend Management**

Vercel dashboard → Account Settings → Billing → Spend Management. Set a monthly hard cap (e.g., $50/month).

- [ ] **Step 4: Deploy and verify**

Push the `feat/voice-demo` branch, create PR, merge to `main`. Vercel auto-deploys.

---

## Implementation Notes

**LiveKit SDK API verification:** The code in Tasks 2-4 is based on current LiveKit documentation and SDK types. Before implementing each task, verify the exact API signatures by checking the installed package types:
- `node_modules/livekit-server-sdk/dist/index.d.ts` — `AccessToken` constructor and `roomConfig` property
- `node_modules/@livekit/components-react/dist/index.d.ts` — `useVoiceAssistant` return type, `LiveKitRoom` props
- `node_modules/livekit-client/dist/livekit-client.d.ts` — `ParticipantKind`, `RoomEvent` enums

If any API differs from what's shown in the plan, consult the LiveKit docs MCP server or the package's TypeScript types and adjust accordingly.

**Error handling for env vars:** The token endpoint uses `process.env.LIVEKIT_API_KEY!` (non-null assertion). This is fine for production (vars are always set in Vercel), but the build step runs at build time without these vars. If the build fails, guard with a runtime check:
```typescript
if (!LIVEKIT_API_KEY) {
  return Response.json({ error: "Server misconfigured" }, { status: 500 });
}
```
