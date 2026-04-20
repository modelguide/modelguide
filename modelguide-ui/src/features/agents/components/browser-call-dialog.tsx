/**
 * BrowserCallDialog — in-browser WebRTC voice test for a LiveKit agent.
 *
 * Flow: click "Start Call" → POST /agents/:id/browser-call to mint a
 * LiveKit access token → connect via livekit-client → publish mic →
 * subscribe to the agent's audio → "End Call" disconnects the room.
 *
 * The backend passes the agent's latest compiled prompt to the worker
 * via dispatch metadata, so this tests the prompt you're iterating on
 * without redeploying.
 */

import { useMutation } from '@tanstack/react-query'
import { HTTPError } from 'ky'
import { ConnectionState, type RemoteAudioTrack, Room, RoomEvent } from 'livekit-client'
import { Mic, MicOff, PhoneOff, Radio } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { api } from '~/lib/api'
import type { BrowserCallResponse } from '~/schemas/agents'

type CallPhase = 'idle' | 'connecting' | 'connected' | 'ended' | 'error'

interface BrowserCallDialogProps {
  open: boolean
  onClose: () => void
  agentId: string
  agentName?: string
}

export function BrowserCallDialog({ open, onClose, agentId, agentName }: BrowserCallDialogProps) {
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const roomRef = useRef<Room | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)

  const cleanup = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect()
      roomRef.current = null
    }
    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null
    }
  }, [])

  const handleClose = useCallback(() => {
    cleanup()
    setPhase('idle')
    setErrorMessage('')
    setSessionId(null)
    setMicEnabled(true)
    onClose()
  }, [cleanup, onClose])

  // Disconnect if the component unmounts while in a call.
  useEffect(() => cleanup, [cleanup])

  const startMutation = useMutation({
    mutationFn: () =>
      api.post(`agents/${agentId}/browser-call`, { json: {} }).json<BrowserCallResponse>(),
    onSuccess: async (data) => {
      setSessionId(data.sessionId)
      try {
        const room = new Room()
        roomRef.current = room

        room.on(RoomEvent.Connected, () => {
          setPhase('connected')
        })
        room.on(RoomEvent.Disconnected, () => {
          setPhase('ended')
        })
        room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Connected) setPhase('connected')
          if (state === ConnectionState.Disconnected) setPhase('ended')
        })
        room.on(RoomEvent.TrackSubscribed, (track) => {
          // Attach the agent's audio track to a hidden audio element.
          if (track.kind === 'audio') {
            const audio = audioElementRef.current
            if (audio) {
              const remoteTrack = track as RemoteAudioTrack
              remoteTrack.attach(audio)
            }
          }
        })

        await room.connect(data.url, data.token)
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch (err) {
        setPhase('error')
        setErrorMessage(err instanceof Error ? err.message : 'Failed to connect')
        cleanup()
      }
    },
    onError: async (err) => {
      setPhase('error')
      if (err instanceof HTTPError) {
        try {
          const body = await err.response.json<{ message?: string }>()
          setErrorMessage(body.message || 'Failed to start call')
        } catch {
          setErrorMessage('Failed to start call')
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to start call')
      }
    },
  })

  function handleStart() {
    setPhase('connecting')
    setErrorMessage('')
    startMutation.mutate()
  }

  async function toggleMic() {
    const room = roomRef.current
    if (!room) return
    const next = !micEnabled
    await room.localParticipant.setMicrophoneEnabled(next)
    setMicEnabled(next)
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      size="sm"
      title={phase === 'idle' ? 'Test Voice Agent' : undefined}
    >
      {/* Hidden element that plays the agent's audio — biome-ignore lint/a11y/useMediaCaption: live agent speech has no transcription track */}
      <audio ref={audioElementRef} autoPlay playsInline aria-label="Agent voice output">
        <track kind="captions" />
      </audio>

      {phase === 'idle' ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Start a browser voice session with{' '}
            <span className="font-medium text-fg-primary">{agentName ?? 'this agent'}</span>. The
            agent will use the latest compiled prompt for this test.
          </p>
          <Button onClick={handleStart} className="w-full">
            <Radio className="h-4 w-4" />
            Start Call
          </Button>
        </div>
      ) : null}

      {phase === 'connecting' ? (
        <div className="flex flex-col items-center py-8 space-y-4">
          <div className="relative">
            <div className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/10">
              <Radio className="h-6 w-6 text-brand-500" />
            </div>
          </div>
          <p className="text-sm text-fg-secondary">Connecting…</p>
        </div>
      ) : null}

      {phase === 'connected' ? (
        <div className="flex flex-col items-center py-8 space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <Radio className="h-6 w-6 text-success" />
          </div>
          <p className="text-sm text-fg-secondary">Connected — talk to your agent</p>
          {sessionId ? (
            <p className="font-mono text-xs text-fg-muted">session {sessionId.slice(0, 8)}…</p>
          ) : null}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={toggleMic}>
              {micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              {micEnabled ? 'Mute' : 'Unmute'}
            </Button>
            <Button variant="danger" onClick={handleClose}>
              <PhoneOff className="h-4 w-4" />
              End Call
            </Button>
          </div>
        </div>
      ) : null}

      {phase === 'ended' ? (
        <div className="flex flex-col items-center py-8 space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fg-subtle/10">
            <PhoneOff className="h-6 w-6 text-fg-muted" />
          </div>
          <p className="text-sm text-fg-secondary">Call ended</p>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="flex flex-col items-center py-8 space-y-4">
          <p className="text-sm text-error">{errorMessage}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
            <Button onClick={handleStart}>Try Again</Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}
