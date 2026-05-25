/**
 * Voice Test panel — WebRTC "Talk to the agent" control surface.
 *
 * Flow:
 *   Dashboard click
 *     → ensureMicPermission() (pre-flight, fail-fast)
 *     → POST /agents/:id/voice-test-token
 *         (API creates session, dispatches worker with the agent's slug as
 *          `agentName` metadata so a multi-profile worker routes to the
 *          right profile, mints a short-lived LiveKit AccessToken)
 *     → <LiveKitRoom> mounts, connects via WebRTC
 *     → RoomAudioRenderer plays the agent's audio (handles autoplay resume)
 *     → RoomController (sibling file) waits for AGENT participant, renders
 *       the in-call toolbar, and exposes disconnect() to hang-up
 *     → on disconnect, worker completes the ModelGuide session in cleanup
 *
 * This file is the shell — session state + mutation + room mount. The three
 * pieces that are self-contained live in `./voice-test/`:
 *   - state.ts          — WidgetState + PHASE_LABEL + timeout constant
 *   - mic-permission.ts — ensureMicPermission() pre-flight probe
 *   - room-controller.tsx — the child that runs inside <LiveKitRoom>
 */

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileCode, Mic, Radio } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, VoiceTestTokenResponse } from '~/schemas/agents'

import { ensureMicPermission } from './voice-test/mic-permission'
import { RoomController } from './voice-test/room-controller'
import { PHASE_LABEL, type WidgetState } from './voice-test/state'

interface VoiceTestPanelProps {
  agent: Agent
  canMutate: boolean
}

export function VoiceTestPanel({ agent, canMutate }: VoiceTestPanelProps) {
  const [state, setState] = useState<WidgetState>('IDLE')
  const [token, setToken] = useState<string | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Hang-up generation counter: once the operator hangs up, the in-flight
  // token fetch's onSuccess must not drag the UI back into a CONNECTING
  // state. `endingRef.current === true` means "we're done, ignore further
  // transitions that would re-engage the call."
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
    setErrorMsg(null)
    setState('IDLE')
  }, [])

  const startMutation = useMutation({
    mutationFn: async (): Promise<VoiceTestTokenResponse> => {
      setErrorMsg(null)
      setState('CHECKING_MIC')
      await ensureMicPermission()
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

  const handleRoomError = useCallback(
    (err: Error) => {
      // LiveKit can fire onError after onDisconnected on some transport
      // failures. Once we've moved to ENDED or IDLE the room is gone —
      // don't bring the UI back to an ERROR state.
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
            Voice Test
          </CardTitle>
          <Badge variant={state === 'CONNECTED' ? 'success' : 'default'} dot>
            {PHASE_LABEL[state]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {livekitConfigured ? (
          <p className="text-sm text-fg-muted">
            Dispatches the configured LiveKit worker with this agent's slug as{' '}
            <code>agentName</code> metadata, then joins the room from your browser so you can talk
            to the agent end-to-end.
          </p>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-fg-secondary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Configure the LiveKit URL, API key, and secret for this agent before testing.
          </div>
        )}

        {livekitConfigured ? (
          <PromptSyncIndicator
            compiledAt={agent.compiledAt}
            hasCompiledPrompt={!!agent.compiledInstructions}
          />
        ) : null}

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

// ---------------------------------------------------------------------------
// Prompt sync indicator
//
// Surfaces whether the worker will pick up a dashboard-edited prompt on the
// next Talk click.  See ADR-015: a LiveKit POC worker calls
// `/agents/me/runtime-config` at session start and uses the agent's
// `compiledInstructions`.  This indicator translates that contract into UX:
//   - has compiled prompt  →  green "synced …" line with the relative timestamp
//   - no compiled prompt   →  warning row pointing the user at the Prompt tab
//
// We deliberately do NOT add a "Sync" button here.  Compile is the canonical
// action and it lives one card up (Prompt tab → Compile). A duplicate button
// here would diverge UX and become a second source of truth.
// ---------------------------------------------------------------------------

function PromptSyncIndicator({
  compiledAt,
  hasCompiledPrompt,
}: {
  compiledAt: string | null | undefined
  hasCompiledPrompt: boolean
}) {
  if (!hasCompiledPrompt) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-fg-subtle/15 bg-bg-subtle/40 p-3 text-xs text-fg-secondary">
        <FileCode className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" />
        <span>
          No compiled prompt yet — open the <strong>Prompt</strong> tab and click{' '}
          <strong>Compile Prompt</strong>. The worker fetches the latest compiled prompt on every
          call.
        </span>
      </div>
    )
  }

  return (
    <p
      className="mt-4 flex items-center gap-1.5 text-xs text-fg-secondary"
      data-testid="prompt-sync-indicator"
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
      <span>
        Worker uses the compiled prompt {compiledAt ? formatRelativeSync(compiledAt) : 'on file'}.
        Recompile to push a new version.
      </span>
    </p>
  )
}

/**
 * Render the compiled-at timestamp as a short relative string so the
 * operator can glance and confirm the call will use what they just
 * compiled. Falls back to the ISO string if Date parsing fails — better to
 * show something machine-readable than nothing.
 */
function formatRelativeSync(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return `(compiled ${iso})`
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 5) return '(compiled just now)'
  if (seconds < 60) return `(compiled ${seconds}s ago)`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `(compiled ${minutes}m ago)`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `(compiled ${hours}h ago)`
  const days = Math.round(hours / 24)
  return `(compiled ${days}d ago)`
}
