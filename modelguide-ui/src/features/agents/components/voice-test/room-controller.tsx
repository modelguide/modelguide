/**
 * RoomController — runs inside the <LiveKitRoom> context.
 *
 * Owns three responsibilities that can only live inside the room context:
 *   1. Wire the room's `disconnect()` to the parent via ref so hang-up can
 *      close the room without reaching into internals.
 *   2. Wait for the agent to actually join (ParticipantKind.AGENT). If it
 *      doesn't within AGENT_JOIN_TIMEOUT_MS, surface an error.
 *   3. Render the in-call toolbar (mic toggle + hang-up).
 *
 * Presentation only — no session state, no token fetching; those are the
 * parent VoiceTestPanel's job.
 */

import { useRoomContext, useVoiceAssistant } from '@livekit/components-react'
import { ParticipantKind, RoomEvent } from 'livekit-client'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'

import { AGENT_JOIN_TIMEOUT_MS, type WidgetState } from './state'

interface RoomControllerProps {
  state: WidgetState
  setState: (s: WidgetState) => void
  onHangUp: () => void
  endingRef: React.MutableRefObject<boolean>
  disconnectRef: React.MutableRefObject<(() => void) | null>
}

export function RoomController({
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
  // <LiveKitRoom>'s own cleanup is skipped.
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
  // If it doesn't within AGENT_JOIN_TIMEOUT_MS, disconnect and surface an
  // error. Covers cold-start + dispatch failure modes.
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
    }, AGENT_JOIN_TIMEOUT_MS)

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

  // Collapse the LiveKit SDK's voice-assistant state + our widget state into
  // a single signal the visualizer renders. Keeps animation mapping local.
  const activity: VoiceActivity =
    state === 'ENDING'
      ? 'disconnecting'
      : voiceAssistant.state === 'speaking'
        ? 'speaking'
        : voiceAssistant.state === 'thinking'
          ? 'thinking'
          : 'listening'

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-8 items-center gap-2.5 rounded-full border border-fg-muted/15 bg-bg-subtle/80 pl-3 pr-3.5"
        aria-live="polite"
      >
        <VoiceVisualizer activity={activity} />
        <span className="text-xs font-medium text-fg-secondary tracking-wide">
          <span className="sr-only">Agent </span>
          {ACTIVITY_LABEL[activity]}
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
// Voice activity visualizer
// ---------------------------------------------------------------------------

type VoiceActivity = 'speaking' | 'thinking' | 'listening' | 'disconnecting'

const ACTIVITY_LABEL: Record<VoiceActivity, string> = {
  speaking: 'Speaking',
  thinking: 'Thinking',
  listening: 'Listening',
  disconnecting: 'Disconnecting',
}

/**
 * Four-bar equalizer that reads as "audio is happening" at a glance.
 *
 * Speaking: ember bars scale-Y bounce with non-uniform delays so motion
 *   feels organic, not mechanical. This is the loud signal.
 * Thinking: warning-tinted bars hold at mid-height and ripple via opacity
 *   L→R — reads as "working, not vocalizing".
 * Listening / Disconnecting: static, muted, quietly present.
 *
 * prefers-reduced-motion drops all animation in app.css; the static bar
 * heights still communicate the activity band (speaking=tall, thinking=mid,
 * listening=low) so state stays legible without motion.
 */
function VoiceVisualizer({ activity }: { activity: VoiceActivity }) {
  // Delays chosen to break sync and feel amplitude-like.
  const bounceDelays = ['0ms', '150ms', '80ms', '220ms']
  // Even stride produces a L→R sweep.
  const waveDelays = ['0ms', '120ms', '240ms', '360ms']

  // `items-end` + `origin-bottom` anchors the bars to the container's
  // baseline so they grow upward like every EQ the user has seen (iOS
  // Siri, Zoom, Slack Huddle, Discord). `origin-center` made the bars
  // breathe in place — wrong visual vocabulary for audio level.
  return (
    <div className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => {
        const styleByActivity =
          activity === 'speaking'
            ? 'h-full bg-brand-500 animate-[voice-bar-bounce_600ms_ease-in-out_infinite]'
            : activity === 'thinking'
              ? 'h-[55%] bg-warning/80 animate-[voice-bar-wave_1200ms_ease-in-out_infinite]'
              : activity === 'disconnecting'
                ? 'h-[25%] bg-fg-muted/40'
                : 'h-[30%] bg-fg-muted/70'
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full origin-bottom transition-colors ${styleByActivity}`}
            style={{
              animationDelay:
                activity === 'speaking'
                  ? bounceDelays[i]
                  : activity === 'thinking'
                    ? waveDelays[i]
                    : undefined,
            }}
          />
        )
      })}
    </div>
  )
}
