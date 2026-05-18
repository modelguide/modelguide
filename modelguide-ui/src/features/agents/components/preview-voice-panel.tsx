/**
 * Preview Voice panel — POC sibling of VoiceTestPanel.
 *
 * Flow:
 *   "Sync & Talk" click
 *     → ensureMicPermission() (pre-flight, fail-fast)
 *     → POST /agents/:id/preview-voice-token
 *         with `{ instructions: <compiled prompt> }` in the body
 *         (API dispatches the *preview* worker — NOT the agent's production
 *          worker — with the prompt baked into dispatch metadata as
 *          `instructions_override`)
 *     → <LiveKitRoom> mounts, connects via WebRTC
 *     → RoomController (shared with VoiceTestPanel) handles the in-call UI
 *
 * The deliberate divergence from VoiceTestPanel is the POST body. Voice-test
 * dispatches the production worker and the worker uses its baked-in prompt
 * (ADR-014). Preview dispatches a separate worker that uses *this* prompt
 * (ADR-015). They share zero state.
 */

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, FileCode, Mic, Radio } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent } from '~/schemas/agents'
import { ensureMicPermission } from './voice-test/mic-permission'
import { RoomController } from './voice-test/room-controller'
import { PHASE_LABEL, type WidgetState } from './voice-test/state'

interface PreviewVoiceTokenResponse {
  livekitUrl: string
  roomName: string
  token: string
  sessionId: string
  dispatchId: string
  agentName: string
  profileName: string
  identity: string
  promptLength: number
}

interface PreviewVoicePanelProps {
  agent: Agent
  /** Compiled prompt to test. Empty string disables the button. */
  instructions: string
  canMutate: boolean
}

export function PreviewVoicePanel({ agent, instructions, canMutate }: PreviewVoicePanelProps) {
  const [state, setState] = useState<WidgetState>('IDLE')
  const [token, setToken] = useState<string | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [promptLength, setPromptLength] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const endingRef = useRef(false)
  const disconnectRef = useRef<(() => void) | null>(null)

  const isLivekit = agent.agentPlatform === 'livekit'
  const lkMeta = ((agent.metadata ?? {}) as Record<string, unknown>).livekit as
    | Record<string, unknown>
    | undefined
  const secretsMap = agent.secrets ?? {}
  // The preview worker can run under either the configured agent's
  // production agentName or a dedicated previewAgentName; either works
  // for "is LiveKit wired up at all?". Secrets must be present so the
  // API can dispatch and mint the AccessToken.
  const livekitConfigured =
    !!lkMeta?.url && !!secretsMap.livekit_api_key && !!secretsMap.livekit_api_secret

  const hasPrompt = instructions.length > 0

  const reset = useCallback(() => {
    endingRef.current = false
    setToken(null)
    setWsUrl(null)
    setSessionId(null)
    setPromptLength(null)
    setErrorMsg(null)
    setState('IDLE')
  }, [])

  const startMutation = useMutation({
    mutationFn: async (): Promise<PreviewVoiceTokenResponse> => {
      setErrorMsg(null)
      setState('CHECKING_MIC')
      await ensureMicPermission()
      setState('REQUESTING_TOKEN')
      return api
        .post(`agents/${agent.id}/preview-voice-token`, {
          json: { instructions },
        })
        .json<PreviewVoiceTokenResponse>()
    },
    onSuccess: (resp) => {
      setSessionId(resp.sessionId)
      setPromptLength(resp.promptLength)
      setToken(resp.token)
      setWsUrl(resp.livekitUrl)
      setState('CONNECTING')
    },
    onError: (err) => {
      setState('ERROR')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start preview')
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
            Preview Voice
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
            Configure the LiveKit URL, API key, and secret for this agent before previewing.
          </div>
        ) : !hasPrompt ? (
          <div className="flex items-start gap-2 rounded-lg border border-fg-muted/20 bg-bg-subtle/40 p-3 text-sm text-fg-secondary">
            <FileCode className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
            Compile a prompt first — there's nothing to preview yet.
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            Dispatches the <code>preview-worker</code> with the current compiled prompt injected as{' '}
            <code>instructions_override</code>, then joins the room so you can hear how the prompt
            sounds before promoting it.
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
              disabled={!canMutate || !livekitConfigured || !hasPrompt}
            >
              <Mic className="h-4 w-4" />
              {state === 'ENDED' ? 'Sync & Talk again' : 'Sync & Talk'}
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
            {promptLength !== null ? ` · prompt ${promptLength} chars` : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
