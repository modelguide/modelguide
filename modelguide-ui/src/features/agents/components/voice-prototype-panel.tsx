/**
 * Voice Prototype panel — sibling of VoiceTestPanel that exercises the
 * prompt-driven LiveKit worker.
 *
 * The difference from "Voice Test" is one endpoint and one Python
 * entrypoint: the prototype dispatches the ``voice-prototype`` worker
 * with the agent's compiled prompt embedded in dispatch metadata. The
 * worker then runs the agent with that prompt verbatim — so an admin can
 * compile a prompt and immediately hear how it sounds, without rolling a
 * new worker profile. See ADR-015 for the separation rationale.
 *
 * UX-wise this reuses the exact same RoomController + LiveKitRoom plumbing
 * as VoiceTestPanel; we deliberately don't duplicate the in-call toolbar
 * or visualizer so any polish landing on Voice Test (e.g. PR #242) lands
 * here for free.
 */

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, FlaskConical, Mic } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, VoicePrototypeTokenResponse } from '~/schemas/agents'

import { ensureMicPermission } from './voice-test/mic-permission'
import { RoomController } from './voice-test/room-controller'
import { PHASE_LABEL, type WidgetState } from './voice-test/state'

interface VoicePrototypePanelProps {
  agent: Agent
  canMutate: boolean
}

export function VoicePrototypePanel({ agent, canMutate }: VoicePrototypePanelProps) {
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
    !!lkMeta?.url && !!secretsMap.livekit_api_key && !!secretsMap.livekit_api_secret
  const hasCompiledPrompt = !!agent.compiledInstructions && agent.compiledInstructions.trim() !== ''

  const reset = useCallback(() => {
    endingRef.current = false
    setToken(null)
    setWsUrl(null)
    setSessionId(null)
    setErrorMsg(null)
    setState('IDLE')
  }, [])

  const startMutation = useMutation({
    mutationFn: async (): Promise<VoicePrototypeTokenResponse> => {
      setErrorMsg(null)
      setState('CHECKING_MIC')
      await ensureMicPermission()
      setState('REQUESTING_TOKEN')
      return api
        .post(`agents/${agent.id}/voice-prototype-token`)
        .json<VoicePrototypeTokenResponse>()
    },
    onSuccess: (resp) => {
      setSessionId(resp.sessionId)
      setToken(resp.token)
      setWsUrl(resp.livekitUrl)
      setState('CONNECTING')
    },
    onError: (err) => {
      setState('ERROR')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start voice prototype')
    },
  })

  const handleHangUp = useCallback(() => {
    endingRef.current = true
    setState('ENDING')
    disconnectRef.current?.()
  }, [])

  const handleDisconnected = useCallback(() => {
    setToken(null)
    setWsUrl(null)
    setState('ENDED')
  }, [])

  const handleRoomError = useCallback(
    (err: Error) => {
      if (endingRef.current || state === 'ENDED' || state === 'IDLE') return
      const name = (err as unknown as { name?: string })?.name
      const msg =
        name === 'NotAllowedError'
          ? 'Microphone access was revoked.'
          : (err?.message ?? 'Connection lost.')
      setErrorMsg(msg)
      setState('ERROR')
    },
    [state],
  )

  if (!isLivekit) return null

  const inCall =
    state === 'CHECKING_MIC' ||
    state === 'REQUESTING_TOKEN' ||
    state === 'CONNECTING' ||
    state === 'CONNECTED' ||
    state === 'ENDING'

  const showStartButton = state === 'IDLE' || state === 'ENDED' || state === 'ERROR'
  const canStart = canMutate && livekitConfigured && hasCompiledPrompt

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Voice Prototype
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
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Compile the prompt first — the prototype dispatches the latest compiled instructions to
            the worker.
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            Dispatches the <code>voice-prototype</code> worker with the agent's latest compiled
            prompt injected in metadata. Use it to hear changes immediately after a compile, without
            redeploying a worker profile.
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
              disabled={!canStart}
            >
              <Mic className="h-4 w-4" />
              {state === 'ENDED' ? 'Talk again' : 'Talk to prototype'}
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
              onError={handleRoomError}
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
