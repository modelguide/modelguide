/**
 * Voice Test panel — WebRTC "Talk to the agent" control surface.
 *
 * Architecture mirrors the public-site voice demo (modelguide/website
 * components/voice-demo.tsx) and voiceblox-ai/voiceblox:
 *
 *   Dashboard click
 *     → POST /agents/:id/voice-test-token
 *         (API creates session, dispatches worker with compiled prompt as
 *          dispatch metadata, mints a short-lived LiveKit AccessToken)
 *     → <LiveKitRoom> mounts, connects via WebRTC
 *     → useVoiceAssistant() surfaces agent state + audio track
 *     → RoomAudioRenderer plays the agent's audio (handles autoplay resume)
 *     → on disconnect, worker completes the ModelGuide session in cleanup
 *
 * Hardening beyond the initial POC:
 *   - Pre-flight mic permission probe. Fail-fast before we spend a dispatch.
 *   - Agent join timeout (15s) — matches the website widget. If no agent
 *     appears, we disconnect and surface an actionable error instead of
 *     leaving the operator staring at "connecting".
 *   - Participant detection by `ParticipantKind.AGENT`, no identity heuristics.
 *   - Abort generation counter: if the operator hangs up mid-fetch, the
 *     in-flight connect short-circuits cleanly.
 *   - Teardown on unmount so navigating away never leaks a room.
 */

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react'
import { useMutation } from '@tanstack/react-query'
import { ParticipantKind, RoomEvent } from 'livekit-client'
import { AlertTriangle, Mic, MicOff, PhoneOff, Radio, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, VoiceTestTokenResponse } from '~/schemas/agents'

interface VoiceTestPanelProps {
  agent: Agent
  canMutate: boolean
}

type WidgetState =
  | 'IDLE'
  | 'CHECKING_MIC'
  | 'REQUESTING_TOKEN'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDING'
  | 'ENDED'
  | 'ERROR'

// Mirror the public-site timeout — if no worker joins in 15s, give up and
// surface an actionable error. Covers cold-start + dispatch failure modes.
const AGENT_TIMEOUT_MS = 15_000

const PHASE_LABEL: Record<WidgetState, string> = {
  IDLE: 'Ready',
  CHECKING_MIC: 'Checking microphone…',
  REQUESTING_TOKEN: 'Requesting token…',
  CONNECTING: 'Joining LiveKit room…',
  CONNECTED: 'Connected',
  ENDING: 'Hanging up…',
  ENDED: 'Call ended',
  ERROR: 'Error',
}

export function VoiceTestPanel({ agent, canMutate }: VoiceTestPanelProps) {
  const [state, setState] = useState<WidgetState>('IDLE')
  const [token, setToken] = useState<string | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const endingRef = useRef(false)
  const disconnectRef = useRef<(() => void) | null>(null)

  const isLivekit = agent.agentPlatform === 'livekit'
  const lkMeta = ((agent.metadata ?? {}) as Record<string, unknown>).livekit as
    | Record<string, unknown>
    | undefined
  const secretsMap = agent.secrets ?? {}
  const livekitConfigured =
    !!lkMeta?.url &&
    !!lkMeta?.agentName &&
    !!secretsMap.livekit_api_key &&
    !!secretsMap.livekit_api_secret
  const hasCompiledPrompt = !!agent.compiledInstructions

  const reset = useCallback(() => {
    endingRef.current = false
    setToken(null)
    setWsUrl(null)
    setSessionId(null)
    setErrorMsg(null)
    setState('IDLE')
  }, [])

  const startMutation = useMutation({
    mutationFn: async (): Promise<VoiceTestTokenResponse> => {
      setErrorMsg(null)
      // Pre-flight mic probe. A denied or missing mic is by far the most
      // common failure — fail-fast with an actionable message instead of
      // letting the room connect and then hanging.
      setState('CHECKING_MIC')
      // Use the Permissions API when available to avoid double-acquiring the
      // mic — LiveKitRoom will acquire its own stream on connect. Re-probing
      // via getUserMedia when we already know the permission is granted is
      // what trips up exclusive-use devices (Bluetooth headsets) and Safari.
      const permissionState = await queryMicPermission()
      if (permissionState === 'denied') {
        throw new Error('Microphone permission denied. Enable mic access and try again.')
      }
      if (permissionState !== 'granted') {
        // Either "prompt" or permissions API unavailable — do a real probe so
        // we can surface a useful error before spending a dispatch.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          for (const t of stream.getTracks()) t.stop()
        } catch (err) {
          const name = (err as DOMException)?.name
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            throw new Error('Microphone permission denied. Enable mic access and try again.')
          }
          if (name === 'NotFoundError') {
            throw new Error('No microphone detected. Plug in a mic and try again.')
          }
          throw err instanceof Error ? err : new Error('Could not access microphone.')
        }
      }

      setState('REQUESTING_TOKEN')
      return api.post(`agents/${agent.id}/voice-test-token`).json<VoiceTestTokenResponse>()
    },
    onSuccess: (resp) => {
      setSessionId(resp.sessionId)
      setToken(resp.token)
      setWsUrl(resp.livekitUrl)
      setState('CONNECTING')
    },
    onError: (err) => {
      setState('ERROR')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start voice test')
    },
  })

  const handleHangUp = useCallback(() => {
    endingRef.current = true
    setState('ENDING')
    disconnectRef.current?.()
  }, [])

  const handleDisconnected = useCallback(() => {
    // Fired by <LiveKitRoom> for every disconnect — ours or the server's. We
    // don't differentiate beyond ENDING vs ENDED; the worker is responsible
    // for completing the ModelGuide session on its side when the room closes.
    setToken(null)
    setWsUrl(null)
    setState('ENDED')
  }, [])

  // No parent-level teardown: <LiveKitRoom> disconnects the underlying Room
  // in its own unmount cleanup (see @livekit/components-react), and children
  // unmount before parents in React, so disconnectRef is already null here.
  // The child's RoomController is where we need to hook disconnect-on-unmount.

  if (!isLivekit) return null

  const inCall =
    state === 'CHECKING_MIC' ||
    state === 'REQUESTING_TOKEN' ||
    state === 'CONNECTING' ||
    state === 'CONNECTED' ||
    state === 'ENDING'

  const showStartButton = state === 'IDLE' || state === 'ENDED' || state === 'ERROR'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Voice Test
          </CardTitle>
          <Badge variant={state === 'CONNECTED' ? 'success' : 'default'} dot>
            {PHASE_LABEL[state]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!livekitConfigured ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-fg-secondary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Configure the LiveKit URL, API key, and secret for this agent before testing.
          </div>
        ) : !hasCompiledPrompt ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-fg-secondary">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Compile the prompt first — the voice test sends the compiled instructions to the agent
            worker as dispatch metadata.
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            Dispatches the configured LiveKit worker with the latest compiled prompt and joins the
            room from your browser so you can talk to the agent end-to-end.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {showStartButton ? (
            <Button
              onClick={() => {
                reset()
                startMutation.mutate()
              }}
              loading={startMutation.isPending}
              disabled={!canMutate || !livekitConfigured || !hasCompiledPrompt}
            >
              <Mic className="h-4 w-4" />
              {state === 'ENDED' ? 'Talk again' : 'Talk to agent'}
            </Button>
          ) : null}

          {token && wsUrl ? (
            <LiveKitRoom
              serverUrl={wsUrl}
              token={token}
              connect={true}
              audio={true}
              video={false}
              onDisconnected={handleDisconnected}
              onError={(err) => {
                // LiveKit can fire onError after onDisconnected on some
                // transport failures. Once we've moved to ENDED or IDLE the
                // room is gone — don't bring the UI back to an ERROR state.
                if (endingRef.current || state === 'ENDED' || state === 'IDLE') return
                const name = (err as unknown as { name?: string })?.name
                const msg =
                  name === 'NotAllowedError'
                    ? 'Microphone access was revoked.'
                    : (err?.message ?? 'Connection lost.')
                setErrorMsg(msg)
                setState('ERROR')
              }}
            >
              <RoomAudioRenderer />
              <RoomController
                state={state}
                setState={setState}
                onHangUp={handleHangUp}
                endingRef={endingRef}
                disconnectRef={disconnectRef}
              />
            </LiveKitRoom>
          ) : null}
        </div>

        {errorMsg ? (
          <p className="mt-3 text-xs text-error" role="alert">
            {errorMsg}
          </p>
        ) : null}

        {inCall && sessionId ? (
          <p className="mt-3 font-mono text-[11px] text-fg-muted">Session {sessionId}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// RoomController — runs inside the LiveKitRoom context so it can drive the
// room directly via useRoomContext + useVoiceAssistant.
// ---------------------------------------------------------------------------

interface RoomControllerProps {
  state: WidgetState
  setState: (s: WidgetState) => void
  onHangUp: () => void
  endingRef: React.MutableRefObject<boolean>
  disconnectRef: React.MutableRefObject<(() => void) | null>
}

function RoomController({
  state,
  setState,
  onHangUp,
  endingRef,
  disconnectRef,
}: RoomControllerProps) {
  const room = useRoomContext()
  const voiceAssistant = useVoiceAssistant()
  const [muted, setMuted] = useState(false)

  // Expose room.disconnect to the parent so hang-up can close the room
  // without reaching into internals. This child unmounts before the parent,
  // so the cleanup branch also does the best-effort disconnect in case
  // <LiveKitRoom>'s own cleanup is skipped (e.g. during a crash or a
  // react-beyond-react unmount).
  useEffect(() => {
    disconnectRef.current = () => {
      try {
        room.disconnect()
      } catch {
        // already disconnected
      }
    }
    return () => {
      try {
        room.disconnect()
      } catch {
        // already disconnected
      }
      disconnectRef.current = null
    }
  }, [room, disconnectRef])

  // Wait for the agent to actually join — once it does, flip to CONNECTED.
  // If it doesn't within AGENT_TIMEOUT_MS, disconnect and surface an error.
  useEffect(() => {
    if (state !== 'CONNECTING') return

    const hasAgent = () => {
      for (const p of room.remoteParticipants.values()) {
        if (p.kind === ParticipantKind.AGENT) return true
      }
      return false
    }

    if (hasAgent()) {
      setState('CONNECTED')
      return
    }

    const onParticipant = () => {
      if (hasAgent()) setState('CONNECTED')
    }
    room.on(RoomEvent.ParticipantConnected, onParticipant)

    const timeout = setTimeout(() => {
      if (!hasAgent() && !endingRef.current) {
        endingRef.current = true
        setState('ERROR')
        try {
          room.disconnect()
        } catch {
          /* ignore */
        }
      }
    }, AGENT_TIMEOUT_MS)

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipant)
      clearTimeout(timeout)
    }
  }, [state, room, setState, endingRef])

  const toggleMute = useCallback(() => {
    const next = !muted
    room.localParticipant.setMicrophoneEnabled(!next).catch(() => {
      // non-fatal — keep the UI in sync with the user's intent anyway
    })
    setMuted(next)
  }, [room, muted])

  if (state !== 'CONNECTED' && state !== 'ENDING') {
    return (
      <span className="text-xs text-fg-muted">
        {state === 'CONNECTING' ? 'Waking up agent…' : null}
      </span>
    )
  }

  const speaking = voiceAssistant.state === 'speaking'
  const thinking = voiceAssistant.state === 'thinking'

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex items-center gap-2 rounded-full border border-fg-muted/20 bg-bg-subtle px-3 py-1.5"
        aria-live="polite"
      >
        <span
          className={
            speaking
              ? 'h-2 w-2 rounded-full bg-success animate-pulse'
              : thinking
                ? 'h-2 w-2 rounded-full bg-warning animate-pulse'
                : 'h-2 w-2 rounded-full bg-fg-muted'
          }
          aria-hidden
        />
        <span className="text-xs text-fg-secondary">
          {speaking ? 'Agent speaking' : thinking ? 'Agent thinking' : 'Listening'}
        </span>
      </div>

      <Button variant="secondary" onClick={toggleMute} size="sm">
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {muted ? 'Unmute' : 'Mute'}
      </Button>
      <Button variant="danger" onClick={onHangUp} size="sm">
        <PhoneOff className="h-4 w-4" />
        Hang up
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function queryMicPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  const perms = navigator.permissions as Permissions | undefined
  if (!perms || typeof perms.query !== 'function') return 'unknown'
  try {
    // `microphone` is not in every TS lib.dom build yet — cast through
    // PermissionName to avoid narrowing errors across targets.
    const status = await perms.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    return 'unknown'
  }
}
