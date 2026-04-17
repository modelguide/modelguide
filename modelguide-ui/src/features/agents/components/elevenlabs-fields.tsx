import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Key, PlusCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { Tooltip } from '~/components/ui/tooltip'
import { api } from '~/lib/api'
import type { Agent } from '~/schemas/agents'
import type { ElevenLabsModelGroup } from '../types'
import { SyncDialog } from './sync-dialog'

interface ElevenLabsFieldsProps {
  agent: Agent
  isAdmin: boolean
}

function getSavedElevenLabsExternalId(elMeta: Record<string, unknown>): string {
  const externalId = elMeta.externalId
  if (typeof externalId === 'string' && externalId.length > 0) {
    return externalId
  }

  const legacyAgentId = elMeta.agentId
  if (typeof legacyAgentId === 'string' && legacyAgentId.length > 0) {
    return legacyAgentId
  }

  return ''
}

export function ElevenLabsFields({ agent, isAdmin }: ElevenLabsFieldsProps) {
  const queryClient = useQueryClient()
  const meta = (agent.metadata ?? {}) as Record<string, unknown>
  const elMeta = (meta.elevenlabs ?? {}) as Record<string, unknown>
  const savedExternalId = getSavedElevenLabsExternalId(elMeta)

  const [elAgentId, setElAgentId] = useState(savedExternalId)
  const [elApiKey, setElApiKey] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [showSyncDialog, setShowSyncDialog] = useState(false)
  const [showRecreateConfirm, setShowRecreateConfirm] = useState(false)
  const [llmModel, setLlmModel] = useState((elMeta.llmModel as string) ?? '')
  const [createElError, setCreateElError] = useState<string | null>(null)

  // Sync form state when server data changes (e.g. after create/save mutations invalidate)
  // Also clears llm model selection when model family changes (it may no longer be valid)
  useEffect(() => {
    const m = ((agent.metadata ?? {}) as Record<string, unknown>).elevenlabs as
      | Record<string, unknown>
      | undefined
    setElAgentId(getSavedElevenLabsExternalId(m ?? {}))
    setLlmModel((m?.llmModel as string) ?? '')
    setElApiKey('')
    setShowApiKeyInput(false)
  }, [agent.metadata])

  const modelFamily = agent.modelFamily ?? 'generic'
  const [prevModelFamily, setPrevModelFamily] = useState(modelFamily)
  useEffect(() => {
    if (prevModelFamily !== modelFamily) {
      setPrevModelFamily(modelFamily)
      setLlmModel('')
    }
  }, [modelFamily, prevModelFamily])

  const { data: modelsData } = useQuery({
    queryKey: ['elevenlabs-models', modelFamily],
    queryFn: () =>
      api
        .get('agents/platform-models', {
          searchParams: { platform: 'elevenlabs', family: modelFamily },
        })
        .json<{ data: ElevenLabsModelGroup[] }>(),
    enabled: agent.agentPlatform === 'elevenlabs',
  })

  const modelOptions = modelsData?.data.flatMap((g) => g.models) ?? []

  const savedLlmModel = (elMeta.llmModel as string) ?? ''
  const isDirty = elAgentId !== savedExternalId || llmModel !== savedLlmModel || elApiKey.length > 0

  const canSync = !!savedExternalId && agent.hasElevenLabsKey && !!elMeta.llmModel

  // All non-API-key fields are disabled until the API key is configured
  const fieldsDisabled = !agent.hasElevenLabsKey || !isAdmin

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (elApiKey) {
        await api
          .put(`agents/${agent.id}/platform-key`, {
            json: { value: elApiKey },
          })
          .json()
      }

      const currentMeta = (agent.metadata ?? {}) as Record<string, unknown>
      const currentEl = (currentMeta.elevenlabs ?? {}) as Record<string, unknown>
      return api
        .patch(`agents/${agent.id}`, {
          json: {
            metadata: {
              ...currentMeta,
              elevenlabs: {
                ...currentEl,
                externalId: elAgentId || undefined,
                agentId: elAgentId || undefined,
                llmModel: llmModel || undefined,
              },
            },
          },
        })
        .json<Agent>()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setElApiKey('')
      setShowApiKeyInput(false)
    },
  })

  const createElevenLabsAgentMutation = useMutation({
    mutationFn: () =>
      api
        .post(`agents/${agent.id}/platform-agent`, {
          json: { platform: 'elevenlabs', ...(savedExternalId ? { force: true } : {}) },
        })
        .json<{ platformAgentId: string }>(),
    onSuccess: (data) => {
      setElAgentId(data.platformAgentId)
      setCreateElError(null)
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
    onError: async (err: unknown) => {
      try {
        const body = (await (err as { response: Response }).response.json()) as {
          message?: string
        }
        setCreateElError(body.message ?? 'Failed to create ElevenLabs agent')
      } catch {
        setCreateElError('Failed to create ElevenLabs agent')
      }
    },
  })

  return (
    <>
      <div className="space-y-4 border-t border-fg-subtle/10 pt-4">
        {/* ElevenLabs API Key — always editable */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-fg-secondary">
            ElevenLabs API Key
            <Tooltip
              content={
                <div className="space-y-1">
                  <p className="font-medium">Required API key permissions:</p>
                  <ul className="list-disc pl-3.5">
                    <li>Conversational AI (read/write)</li>
                    <li>Webhooks (write)</li>
                  </ul>
                </div>
              }
              side="top"
              className="whitespace-normal max-w-56"
            >
              <Info className="h-3.5 w-3.5 cursor-help" />
            </Tooltip>
          </div>
          <div>
            <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3 max-w-md">
              <Key className="h-4 w-4 text-fg-muted" />
              <span className="flex-1 text-xs text-fg-secondary">
                {agent.hasElevenLabsKey ? 'Configured' : 'Not configured'}
              </span>
              {agent.hasElevenLabsKey ? (
                <Badge variant="success" dot>
                  active
                </Badge>
              ) : null}
            </div>
            {isAdmin ? (
              showApiKeyInput ? (
                <div className="mt-2 max-w-md">
                  <Input
                    type="password"
                    value={elApiKey}
                    onChange={(e) => setElApiKey(e.target.value)}
                    placeholder="sk_..."
                  />
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowApiKeyInput(true)}
                  className="mt-2"
                >
                  {agent.hasElevenLabsKey ? 'Update Key' : 'Configure Key'}
                </Button>
              )
            ) : null}
          </div>
        </div>

        {/* ElevenLabs Agent ID — disabled until API key is configured */}
        <div className="max-w-md">
          <label
            htmlFor="elevenlabs-agent-id"
            className="mb-1.5 block text-sm font-medium text-fg-secondary"
          >
            ElevenLabs Agent ID
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                id="elevenlabs-agent-id"
                value={elAgentId}
                onChange={(e) => setElAgentId(e.target.value)}
                placeholder="e.g., agent_abc123"
                disabled={fieldsDisabled}
              />
            </div>
            {isAdmin && !elAgentId ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (savedExternalId) {
                    setShowRecreateConfirm(true)
                  } else {
                    createElevenLabsAgentMutation.mutate()
                  }
                }}
                loading={createElevenLabsAgentMutation.isPending}
                disabled={fieldsDisabled}
                className="shrink-0"
              >
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                Create on ElevenLabs
              </Button>
            ) : null}
          </div>
          {createElError ? <p className="mt-1 text-xs text-error">{createElError}</p> : null}
        </div>

        {/* LLM Model — disabled until API key is configured */}
        {agent.agentPlatform === 'elevenlabs' ? (
          <div className="max-w-md">
            <Select
              label="LLM Model"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              disabled={fieldsDisabled}
            >
              <option value="">Select a model...</option>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="flex items-center gap-4 text-xs text-fg-muted">
          <span className={savedExternalId ? 'text-success' : ''}>
            {savedExternalId ? '\u2713' : '\u2717'} Agent ID
          </span>
          <span className={agent.hasElevenLabsKey ? 'text-success' : ''}>
            {agent.hasElevenLabsKey ? '\u2713' : '\u2717'} API Key
          </span>
        </div>

        {isAdmin ? (
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={!isDirty}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowSyncDialog(true)}
              disabled={!canSync || isDirty}
            >
              Sync to ElevenLabs
            </Button>
            {elMeta.lastSyncedAt ? (
              <a
                href={`https://elevenlabs.io/app/conversational-ai/agents/${savedExternalId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 flex items-center gap-1.5 rounded-md bg-bg-subtle px-2.5 py-1.5 text-xs transition-colors hover:bg-bg-subtle/70"
              >
                <RefreshCw className="h-3 w-3 shrink-0 text-success" />
                {elMeta.agentName ? (
                  <span className="font-medium text-fg-primary">{elMeta.agentName as string}</span>
                ) : null}
                <span className="text-fg-muted">
                  Synced {new Date(elMeta.lastSyncedAt as string).toLocaleString()}
                </span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <SyncDialog
        agentId={agent.id}
        open={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
      />

      <Dialog
        open={showRecreateConfirm}
        onClose={() => setShowRecreateConfirm(false)}
        title="Replace ElevenLabs Agent?"
        description={`This will create a new ElevenLabs agent and replace the saved agent ID (${savedExternalId}). The existing ElevenLabs agent will not be deleted.`}
      >
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowRecreateConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setShowRecreateConfirm(false)
              createElevenLabsAgentMutation.mutate()
            }}
            loading={createElevenLabsAgentMutation.isPending}
          >
            Replace
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
