/**
 * PrototypeVoiceTestPanel — ADR-015 "compile → sync → talk" prototype loop.
 *
 * One button. Click it and the dashboard:
 *   1. ensures mic permission,
 *   2. POSTs /agents/:id/compile so compiled_instructions reflects the latest
 *      SOP + guardrail text,
 *   3. POSTs /agents/:id/prototype-voice-test-token, which dispatches a
 *      LiveKit worker (`examples/agents/livekit-prototype/`) with the
 *      compiled prompt embedded in dispatch metadata,
 *   4. mounts <LiveKitRoom> and joins the room over WebRTC.
 *
 * Trade-off vs the production VoiceTestPanel (ADR-014): that one dispatches
 * the deployed worker as-is and lets the worker's profile own the prompt.
 * This panel injects the prompt — closer to "what you see is what you'll
 * hear" — at the cost of no longer testing exactly what's deployed.
 *
 * Audience: prompt iteration during development. Not a substitute for testing
 * the production worker before shipping a SOP change.
 */

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Mic, Radio } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, PrototypeVoiceTestTokenResponse } from '~/schemas/agents'

import { ensureMicPermission } from './voice-test/mic-permission'
import { RoomController } from './voice-test/room-controller'
import { PHASE_LABEL, type WidgetState } from './voice-test/state'

interface PrototypeVoiceTestPanelProps {
  agent: Agent
  canMutate: boolean
}

export function PrototypeVoiceTestPanel({ agent, canMutate }: PrototypeVoiceTestPanelProps) {
  const [state, setState] = useState<WidgetState>('IDLE')
  const [token, setToken] = useState<string | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [promptHash, setPromptHash] = useState<string | null>(null)
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

  const reset = useCallback(() => {
    endingRef.current = false
    setToken(null)
    setWsUrl(null)
    setSessionId(null)
    setPromptHash(null)
    setErrorMsg(null)
    setState('IDLE')
  }, [])

  const startMutation = useMutation({
    mutationFn: async (): Promise<PrototypeVoiceTestTokenResponse> => {
      setErrorMsg(null)
      setState('CHECKING_MIC')
      await ensureMicPermission()

      // Step 1 — compile so the worker reads the freshest text. We don't
      // care about the response payload here; the API persists
      // compiled_instructions, which the next call reads from the DB.
      setState('REQUESTING_TOKEN')
      await api.post(`agents/${agent.id}/compile`).json<unknown>()

      // Step 2 — dispatch the prototype worker with the refreshed prompt.
      return api
        .post(`agents/${agent.id}/prototype-voice-test-token`)
        .json<PrototypeVoiceTestTokenResponse>()
    },
    onSuccess: (resp) => {
      setSessionId(resp.sessionId)
      setToken(resp.token)
      setWsUrl(resp.livekitUrl)
      setPromptHash(resp.instructionsHash)
      setState('CONNECTING')
    },
    onError: (err) => {
      setState('ERROR')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start prototype voice test')
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Prototype Voice Test
          </CardTitle>
          <Badge variant={state === 'CONNECTED' ? 'success' : 'default'} dot>
            {PHASE_LABEL[state]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {livekitConfigured ? (
          <p className="text-sm text-fg-muted">
            Recompiles the prompt, dispatches the prototype LiveKit worker with the freshly compiled
            instructions in metadata, then joins the room from your browser. Use this for tight
            prompt-iteration loops — the production voice-test panel is what you ship.
          </p>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-fg-secondary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Configure the LiveKit URL, API key, and secret for this agent before testing.
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {showStartButton ? (
            <Button
              onClick={() => {
                reset()
                startMutation.mutate()
              }}
              loading={startMutation.isPending}
              disabled={!canMutate || !livekitConfigured}
            >
              <Mic className="h-4 w-4" />
              {state === 'ENDED' ? 'Sync & test again' : 'Sync & test prompt'}
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
          <p className="mt-3 font-mono text-[11px] text-fg-muted">
            Session {sessionId}
            {promptHash ? ` · prompt #${promptHash}` : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
