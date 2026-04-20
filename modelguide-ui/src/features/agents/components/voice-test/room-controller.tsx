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
