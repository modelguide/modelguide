import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileCode, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { ViewToggle } from '~/components/ui/view-toggle'
import { CompileDialog } from '~/features/prompt-compiler/components/compile-dialog'
import { CompileSummaryBar } from '~/features/prompt-compiler/components/compile-summary-bar'
import { PromptViewer } from '~/features/prompt-compiler/components/prompt-viewer'
import { api } from '~/lib/api'
import type { Agent, PromptConfig } from '~/schemas/agents'

interface PromptSectionProps {
  agent: Agent
  canMutate: boolean
}

type Tab = 'configuration' | 'compiled'

export function PromptSection({ agent, canMutate }: PromptSectionProps) {
  const defaultTab: Tab = agent.compiledInstructions ? 'compiled' : 'configuration'
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab)
  const [showCompileDialog, setShowCompileDialog] = useState(false)

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <CardTitle>Prompt</CardTitle>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-fg-subtle/10 bg-bg-base p-0.5">
              <TabButton
                active={activeTab === 'configuration'}
                onClick={() => setActiveTab('configuration')}
                isDirty={false}
              >
                Configuration
              </TabButton>
              <TabButton active={activeTab === 'compiled'} onClick={() => setActiveTab('compiled')}>
                Compiled
              </TabButton>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === 'configuration' ? (
            <ConfigurationTab agent={agent} canMutate={canMutate} />
          ) : (
            <CompiledTab
              agent={agent}
              canMutate={canMutate}
              onCompile={() => setShowCompileDialog(true)}
            />
          )}
        </CardContent>
      </Card>

      {showCompileDialog ? (
        <CompileDialog
          open
          onClose={() => setShowCompileDialog(false)}
          agentId={agent.id}
          currentPrompt={agent.compiledInstructions ?? null}
        />
      ) : null}
    </>
  )
}

function TabButton({
  active,
  onClick,
  isDirty,
  children,
}: {
  active: boolean
  onClick: () => void
  isDirty?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-bg-elevated text-fg-primary shadow-sm'
          : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {children}
      {isDirty ? <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> : null}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Markdown field with editor/preview toggle
// ---------------------------------------------------------------------------

function MarkdownField({
  label,
  value,
  onChange,
  minRows = 5,
  disabled,
}: {
  label: string
  value: string
  onChange: (val: string) => void
  minRows?: number
  disabled?: boolean
}) {
  const [view, setView] = useState<'editor' | 'preview'>('editor')

  return (
    <div className="rounded-xl border border-fg-subtle/10 bg-bg-base overflow-hidden">
      <div className="border-b border-fg-subtle/10 px-4 py-2">
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { value: 'editor', label: 'Editor' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
      </div>
      <div className="p-4">
        {view === 'editor' ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={minRows}
            className="w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 font-mono text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-y"
          />
        ) : value ? (
          <div className="prose prose-sm prose-invert max-w-none text-fg-secondary [&_strong]:text-fg-primary [&_h1]:text-fg-primary [&_h2]:text-fg-primary [&_h3]:text-fg-primary [&_li]:text-fg-secondary [&_a]:text-brand-400">
            <Markdown>{value}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-fg-muted italic">No content</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Configuration tab
// ---------------------------------------------------------------------------

function ConfigurationTab({ agent, canMutate }: { agent: Agent; canMutate: boolean }) {
  const queryClient = useQueryClient()

  const [persona, setPersona] = useState(agent.promptConfig?.persona ?? '')
  const [language, setLanguage] = useState(agent.promptConfig?.language ?? '')
  const [fillerPhrases, setFillerPhrases] = useState<string[]>(
    agent.promptConfig?.fillerPhrases ?? [],
  )

  // Sync with server data when agent changes
  useEffect(() => {
    setPersona(agent.promptConfig?.persona ?? '')
    setLanguage(agent.promptConfig?.language ?? '')
    setFillerPhrases(agent.promptConfig?.fillerPhrases ?? [])
  }, [agent.promptConfig])

  const isDirty =
    persona !== (agent.promptConfig?.persona ?? '') ||
    language !== (agent.promptConfig?.language ?? '') ||
    JSON.stringify(fillerPhrases) !== JSON.stringify(agent.promptConfig?.fillerPhrases ?? [])

  const saveMutation = useMutation({
    mutationFn: () => {
      const promptConfig: PromptConfig = {}
      if (persona) promptConfig.persona = persona
      if (language) promptConfig.language = language
      if (fillerPhrases.length > 0) promptConfig.fillerPhrases = fillerPhrases
      return api.patch(`agents/${agent.id}`, { json: { promptConfig } }).json<Agent>()
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['agents', agent.id], updated)
      toast.success('Configuration saved')
    },
    onError: () => {
      toast.error('Failed to save configuration')
    },
  })

  function addPhrase() {
    setFillerPhrases((prev) => [...prev, ''])
  }

  function updatePhrase(index: number, value: string) {
    setFillerPhrases((prev) => prev.map((p, i) => (i === index ? value : p)))
  }

  function removePhrase(index: number) {
    setFillerPhrases((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      {/* Persona */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg-secondary">Persona</p>
        <MarkdownField
          label="Persona"
          value={persona}
          onChange={setPersona}
          minRows={7}
          disabled={!canMutate}
        />
      </div>

      {/* Language */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg-secondary">Language</p>
        <MarkdownField
          label="Language"
          value={language}
          onChange={setLanguage}
          minRows={4}
          disabled={!canMutate}
        />
      </div>

      {/* Filler Phrases */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-fg-secondary">Filler phrases</p>
        <div className="space-y-2">
          {fillerPhrases.map((phrase, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: order-stable list
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={phrase}
                onChange={(e) => updatePhrase(i, e.target.value)}
                className="flex h-9 flex-1 rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="e.g. One moment."
              />
              <button
                type="button"
                onClick={() => removePhrase(i)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-error/10 hover:text-error"
                aria-label="Remove phrase"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addPhrase}
            className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add phrase
          </button>
        </div>
      </div>

      {canMutate ? (
        <div className="flex items-center justify-between border-t border-fg-subtle/10 pt-4">
          {isDirty ? <span className="text-xs text-fg-muted">Unsaved changes</span> : <span />}
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!isDirty}
          >
            Save configuration
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compiled tab
// ---------------------------------------------------------------------------

function CompiledTab({
  agent,
  canMutate,
  onCompile,
}: {
  agent: Agent
  canMutate: boolean
  onCompile: () => void
}) {
  const hasCompiledPrompt = !!agent.compiledInstructions

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <FileCode className="h-4 w-4" />
          <span>Compiled prompt</span>
        </div>
        {canMutate ? (
          <Button variant="primary" size="sm" onClick={onCompile}>
            {hasCompiledPrompt ? 'Recompile' : 'Compile Prompt'}
          </Button>
        ) : null}
      </div>

      {hasCompiledPrompt ? (
        <div className="space-y-4">
          {agent.compiledFrom ? (
            <CompileSummaryBar
              compiledFrom={agent.compiledFrom}
              promptLength={agent.compiledInstructions?.length ?? 0}
              compiledAt={agent.compiledAt ?? undefined}
            />
          ) : null}
          <PromptViewer content={agent.compiledInstructions ?? ''} maxLines={15} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileCode className="h-8 w-8 text-fg-muted" />
          <p className="mt-3 text-sm text-fg-muted">No compiled prompt yet</p>
          {canMutate ? (
            <p className="mt-1 text-xs text-fg-muted">
              Compile a prompt from an assigned SOP to configure this agent's instructions.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
