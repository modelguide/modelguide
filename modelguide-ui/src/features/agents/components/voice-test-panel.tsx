/**
 * Voice Test panel — WebRTC "Talk to the agent" POC.
 *
 * Inspired by voiceblox-ai/voiceblox: one button kicks off a LiveKit room,
 * the backend dispatches the agent worker with the current compiled prompt as
 * dispatch metadata, and the browser joins the room over WebRTC to talk.
 *
 * Uses the existing agent LiveKit config (url + apiKey/apiSecret secrets +
 * agentName). Shows a short status timeline so callers can see what stage the
 * setup is in: token → connecting → agent joined → speaking.
 */

import { useMutation } from '@tanstack/react-query'
import {
  ConnectionState,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
} from 'livekit-client'
import { AlertTriangle, Mic, MicOff, PhoneOff, Radio, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, VoiceTestTokenResponse } from '~/schemas/agents'

interface VoiceTestPanelProps {
  agent: Agent
  canMutate: boolean
}

type Phase =
  | 'idle'
  | 'requesting_token'
  | 'connecting'
  | 'waiting_for_agent'
  | 'connected'
  | 'disconnected'
  | 'error'

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Ready',
  requesting_token: 'Requesting token…',
  connecting: 'Joining LiveKit room…',
  waiting_for_agent: 'Waiting for agent…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
}

export function VoiceTestPanel({ agent, canMutate }: VoiceTestPanelProps) {
  const roomRef = useRef<Room | null>(null)
  const localTrackRef = useRef<LocalAudioTrack | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [micOn, setMicOn] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const isLivekit = agent.agentPlatform === 'livekit'
  const lkMeta = ((agent.metadata ?? {}) as Record<string, unknown>).livekit as
    | Record<string, unknown>
    | undefined
  const secretsMap = (agent as unknown as { secrets?: Record<string, string> }).secrets ?? {}
  const livekitConfigured =
    !!lkMeta?.url &&
    !!lkMeta?.agentName &&
    !!secretsMap.livekit_api_key &&
    !!secretsMap.livekit_api_secret
  const hasCompiledPrompt = !!agent.compiledInstructions

  const startMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      setPhase('requesting_token')
      const resp = await api
        .post(`agents/${agent.id}/voice-test-token`)
        .json<VoiceTestTokenResponse>()
      return resp
    },
    onSuccess: async (resp) => {
      setSessionId(resp.sessionId)
      await connectToRoom(resp)
    },
    onError: (err) => {
      setPhase('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start voice test')
    },
  })

  async function connectToRoom(resp: VoiceTestTokenResponse) {
    setPhase('connecting')

    const room = new Room({ adaptiveStream: true, dynacast: true })
    roomRef.current = room

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Disconnected) {
        setPhase('disconnected')
      }
    })
    room.on(RoomEvent.ParticipantConnected, (p) => {
      // Agent worker joins as a remote participant — once we see them we can
      // flip the UI from "waiting" to "connected" even before they speak.
      if (isAgentParticipant(p, resp.agentName)) {
        setPhase('connected')
      }
    })
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio && isAgentParticipant(participant, resp.agentName)) {
          const audioEl = audioElRef.current
          if (audioEl) {
            ;(track as RemoteAudioTrack).attach(audioEl)
          }
          setPhase('connected')
        }
      },
    )

    try {
      await room.connect(resp.livekitUrl, resp.token)
      const micTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      localTrackRef.current = micTrack
      await room.localParticipant.publishTrack(micTrack)
      setPhase('waiting_for_agent')
    } catch (err) {
      setPhase('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect to LiveKit')
      await hangUp()
    }
  }

  async function hangUp() {
    const room = roomRef.current
    const track = localTrackRef.current
    try {
      track?.stop()
      await room?.disconnect()
    } finally {
      roomRef.current = null
      localTrackRef.current = null
      setPhase('idle')
      setMicOn(true)
      setSessionId(null)
    }
  }

  function toggleMic() {
    const track = localTrackRef.current
    if (!track) return
    if (micOn) {
      track.mute()
    } else {
      track.unmute()
    }
    setMicOn(!micOn)
  }

  // Clean up on unmount so we don't leave rooms open when navigating away.
  useEffect(() => {
    return () => {
      localTrackRef.current?.stop()
      roomRef.current?.disconnect().catch(() => {})
    }
  }, [])

  if (!isLivekit) {
    return null
  }

  const inCall = phase === 'connecting' || phase === 'waiting_for_agent' || phase === 'connected'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Voice Test
          </CardTitle>
          <Badge variant={phase === 'connected' ? 'success' : 'default'} dot>
            {PHASE_LABELS[phase]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* biome-ignore lint/a11y/useMediaCaption: agent audio has no caption track */}
        <audio ref={audioElRef} autoPlay playsInline />

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

        <div className="mt-4 flex items-center gap-2">
          {!inCall ? (
            <Button
              onClick={() => startMutation.mutate()}
              loading={startMutation.isPending}
              disabled={!canMutate || !livekitConfigured || !hasCompiledPrompt}
            >
              <Mic className="h-4 w-4" />
              Talk to agent
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={toggleMic}>
                {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                {micOn ? 'Mute' : 'Unmute'}
              </Button>
              <Button variant="danger" onClick={hangUp}>
                <PhoneOff className="h-4 w-4" />
                Hang up
              </Button>
            </>
          )}
        </div>

        {errorMsg ? (
          <p className="mt-3 text-xs text-error" role="alert">
            {errorMsg}
          </p>
        ) : null}

        {sessionId ? (
          <p className="mt-3 font-mono text-[11px] text-fg-muted">Session {sessionId}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function isAgentParticipant(p: RemoteParticipant, agentName: string): boolean {
  // LiveKit worker dispatches identify themselves via the `agent` prefix or
  // the configured agent name. Match either so different worker SDKs behave
  // consistently.
  const identity = p.identity ?? ''
  return identity === agentName || identity.startsWith('agent-') || identity.includes(agentName)
}
