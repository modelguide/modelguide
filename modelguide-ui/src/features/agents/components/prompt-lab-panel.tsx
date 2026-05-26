/**
 * Prompt Lab — POC voice-test surface with a live prompt editor (ADR-015).
 *
 * The standard VoiceTestPanel dispatches the worker against its baked-in
 * profile prompt. This panel additionally sends the textarea content as
 * `prompt_override` in dispatch metadata so the worker uses it as the
 * agent's instructions for the session.
 *
 * Same room / mic / state-machine plumbing as VoiceTestPanel — the only
 * differences are the POST body, the seeded textarea, and the button copy.
 */

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, FlaskConical, Mic } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, VoiceTestTokenResponse } from '~/schemas/agents'

import { ensureMicPermission } from './voice-test/mic-permission'
import { RoomController } from './voice-test/room-controller'
import { PHASE_LABEL, type WidgetState } from './voice-test/state'

interface PromptLabPanelProps {
  agent: Agent
  canMutate: boolean
}

export function PromptLabPanel({ agent, canMutate }: PromptLabPanelProps) {
  const [state, setState] = useState<WidgetState>('IDLE')
  const [token, setToken] = useState<string | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<string>(agent.compiledInstructions ?? '')

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

  const promptTrimmedEmpty = useMemo(() => prompt.trim().length === 0, [prompt])
  // Mirror the server's 60 KB max (PROMPT_LAB_MAX_BYTES = 50 000 bytes, with
  // the route schema sitting at 60 000 chars for an early reject). Use chars
  // here — cheap, and slightly stricter than bytes for a UI guard.
  const promptTooLong = prompt.length > 60_000

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
      setState('CHECKING_MIC')
      await ensureMicPermission()
      setState('REQUESTING_TOKEN')
      return api
        .post(`agents/${agent.id}/voice-test-prompt`, { json: { prompt } })
        .json<VoiceTestTokenResponse>()
    },
    onSuccess: (resp) => {
      setSessionId(resp.sessionId)
      setToken(resp.token)
      setWsUrl(resp.livekitUrl)
      setState('CONNECTING')
    },
    onError: (err) => {
      setState('ERROR')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start Prompt Lab session')
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

  const disabled = !canMutate || !livekitConfigured || promptTrimmedEmpty || promptTooLong

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Prompt Lab
            <Badge variant="warning">POC</Badge>
          </CardTitle>
          <Badge variant={state === 'CONNECTED' ? 'success' : 'default'} dot>
            {PHASE_LABEL[state]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {livekitConfigured ? (
          <p className="text-sm text-fg-muted">
            Edit the prompt, click <strong>Sync &amp; Talk</strong>, and the deployed LiveKit worker
            will use your edits as the agent's instructions for this session — no redeploy. See
            ADR-015 for trade-offs.
          </p>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-fg-secondary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Configure the LiveKit URL, API key, and secret for this agent before testing.
          </div>
        )}

        <textarea
          aria-label="Prompt"
          className="mt-4 w-full min-h-[280px] rounded-lg border border-bg-subtle bg-bg-subtle p-3 font-mono text-xs text-fg-primary placeholder:text-fg-muted focus:border-brand-500/60 focus:outline-none"
          value={prompt}
          placeholder="You are a helpful voice assistant…"
          onChange={(e) => setPrompt(e.target.value)}
          spellCheck={false}
          disabled={inCall}
        />

        <div className="mt-2 flex items-center justify-between text-[11px] text-fg-muted">
          <span className="font-mono">{prompt.length.toLocaleString()} chars</span>
          {promptTooLong ? (
            <span className="text-error">Too long — keep under 60,000 chars.</span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {showStartButton ? (
            <Button
              onClick={() => {
                reset()
                startMutation.mutate()
              }}
              loading={startMutation.isPending}
              disabled={disabled}
            >
              <Mic className="h-4 w-4" />
              {state === 'ENDED' ? 'Sync & talk again' : 'Sync & Talk'}
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
