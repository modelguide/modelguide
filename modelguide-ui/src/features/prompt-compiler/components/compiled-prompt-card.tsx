import { FileCode } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { PreviewVoicePanel } from '~/features/agents/components/preview-voice-panel'
import type { Agent } from '~/schemas/agents'
import { CompileDialog } from './compile-dialog'
import { CompileSummaryBar } from './compile-summary-bar'
import { PromptViewer } from './prompt-viewer'

interface CompiledPromptCardProps {
  agent: Agent
  canMutate: boolean
}

export function CompiledPromptCard({ agent, canMutate }: CompiledPromptCardProps) {
  const [showDialog, setShowDialog] = useState(false)

  const hasCompiledPrompt = !!agent.compiledInstructions
  // Only voice agents on the LiveKit platform can be previewed via the
  // POC preview-worker. The PreviewVoicePanel itself renders nothing for
  // non-livekit agents — but skipping the render here also avoids an
  // empty Card on text agents.
  const canPreview = agent.modality === 'voice' && agent.agentPlatform === 'livekit'

  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Compiled Prompt
            </CardTitle>
            {canMutate ? (
              <Button variant="secondary" size="sm" onClick={() => setShowDialog(true)}>
                {hasCompiledPrompt ? 'Recompile' : 'Compile Prompt'}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {canPreview ? (
        <div className="lg:col-span-2">
          <PreviewVoicePanel
            agent={agent}
            instructions={agent.compiledInstructions ?? ''}
            canMutate={canMutate}
          />
        </div>
      ) : null}

      {showDialog ? (
        <CompileDialog
          open
          onClose={() => setShowDialog(false)}
          agentId={agent.id}
          currentPrompt={agent.compiledInstructions ?? null}
        />
      ) : null}
    </>
  )
}
