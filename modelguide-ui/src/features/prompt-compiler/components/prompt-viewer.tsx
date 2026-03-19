import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

interface PromptViewerProps {
  content: string
  maxLines?: number
  className?: string
  defaultView?: 'structured' | 'raw'
}

interface PromptSection {
  type: 'preamble' | 'workflow' | 'tools' | 'guardrails' | 'escalation' | 'other'
  heading?: string
  lines: string[]
}

const sectionColors: Record<PromptSection['type'], string> = {
  preamble: 'border-transparent',
  workflow: 'border-violet-500/40',
  tools: 'border-teal-500/40',
  guardrails: 'border-amber-500/40',
  escalation: 'border-error/40',
  other: 'border-fg-subtle/20',
}

function parsePromptSections(content: string): PromptSection[] {
  const lines = content.split('\n')
  const sections: PromptSection[] = []
  let current: PromptSection = { type: 'preamble', lines: [] }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/)
    if (headingMatch) {
      if (current.lines.length > 0 || current.heading) {
        sections.push(current)
      }

      const heading = headingMatch[1].trim()
      let type: PromptSection['type'] = 'other'
      const lower = heading.toLowerCase()
      if (lower.startsWith('workflow') || lower.startsWith('procedure')) type = 'workflow'
      else if (lower === 'tools' || lower.startsWith('available tools')) type = 'tools'
      else if (lower === 'guardrails' || lower.startsWith('guardrail')) type = 'guardrails'
      else if (lower.startsWith('escalation')) type = 'escalation'

      current = { type, heading, lines: [] }
    } else {
      current.lines.push(line)
    }
  }

  if (current.lines.length > 0 || current.heading) {
    sections.push(current)
  }

  return sections
}

function getGuardrailPriority(line: string): 'critical' | 'high' | 'medium' | 'low' | null {
  const lower = line.toLowerCase()
  if (lower.startsWith('### critical') || lower.includes('**critical')) return 'critical'
  if (lower.startsWith('### high') || lower.includes('**high')) return 'high'
  if (lower.startsWith('### medium') || lower.includes('**medium')) return 'medium'
  if (lower.startsWith('### low') || lower.includes('**low')) return 'low'
  return null
}

const priorityVariantMap: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'default',
}

function StructuredView({ content }: { content: string }) {
  const sections = useMemo(() => parsePromptSections(content), [content])

  return (
    <div className="space-y-1">
      {sections.map((section, i) => (
        <div
          key={section.heading ?? `preamble-${i}`}
          className={cn(
            'animate-fade-up',
            section.type !== 'preamble' && 'border-l-2 pl-4',
            sectionColors[section.type],
          )}
          style={{ animationDelay: `${i * 50}ms` }}
        >
          {section.heading ? (
            <h3 className="font-display text-sm font-semibold text-fg-primary mb-2">
              {section.heading}
            </h3>
          ) : null}
          <div className="space-y-1">
            {section.lines.map((line, j) => {
              if (!line.trim()) return null

              // Tool references
              if (section.type === 'tools' && line.match(/^- /)) {
                const toolName = line
                  .replace(/^- /, '')
                  .split(/\s[—–-]\s/)[0]
                  .trim()
                return (
                  <span
                    key={`${section.heading}-tool-${j}`}
                    className="mr-1.5 mb-1 inline-flex items-center rounded-md bg-violet-500/[0.08] px-2.5 py-1 font-mono text-xs text-violet-400 ring-1 ring-violet-500/15"
                  >
                    {toolName}
                  </span>
                )
              }

              // Guardrail priorities
              if (section.type === 'guardrails') {
                const priority = getGuardrailPriority(line)
                if (priority) {
                  return (
                    <div key={`${section.heading}-priority-${j}`} className="mt-2 mb-1">
                      <Badge variant={priorityVariantMap[priority]}>
                        {priority.charAt(0).toUpperCase() + priority.slice(1)}
                      </Badge>
                    </div>
                  )
                }
                const boldMatch = line.match(/^\*\*(.+?)\*\*:?\s*(.*)/)
                if (boldMatch) {
                  return (
                    <p
                      key={`${section.heading}-rule-${j}`}
                      className="text-sm text-fg-secondary leading-relaxed"
                    >
                      <strong className="text-fg-primary">{boldMatch[1]}</strong>
                      {boldMatch[2] ? `: ${boldMatch[2]}` : ''}
                    </p>
                  )
                }
              }

              // Escalation triggers
              if (section.type === 'escalation' && line.match(/^- /)) {
                return (
                  <p
                    key={`${section.heading}-trigger-${j}`}
                    className="flex items-start gap-2 text-sm text-fg-secondary leading-relaxed"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-error/50" />
                    {line.replace(/^- /, '')}
                  </p>
                )
              }

              return (
                <p
                  key={`${section.heading}-text-${j}`}
                  className="text-sm text-fg-secondary leading-relaxed"
                >
                  {line}
                </p>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function RawView({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const lines = content.split('\n')

  function handleCopy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 rounded-lg p-1.5 text-fg-muted hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="overflow-x-auto">
        <code className="block">
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: line numbers in raw view are stable and ordered
            <div key={i} className="flex leading-5">
              <span className="w-10 shrink-0 text-right pr-3 text-fg-muted/50 select-none border-r border-fg-subtle/10 font-mono text-[13px]">
                {i + 1}
              </span>
              <span className="pl-3 font-mono text-[13px] text-fg-secondary whitespace-pre-wrap break-words min-w-0">
                {line || '\u200b'}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  )
}

export function PromptViewer({
  content,
  maxLines,
  className,
  defaultView = 'structured',
}: PromptViewerProps) {
  const [view, setView] = useState<'structured' | 'raw'>(defaultView)
  const [expanded, setExpanded] = useState(!maxLines)

  const allLines = useMemo(() => content.split('\n'), [content])
  const lineCount = allLines.length
  const shouldTruncate = maxLines && lineCount > maxLines && !expanded
  const displayContent = shouldTruncate ? allLines.slice(0, maxLines).join('\n') : content

  return (
    <div
      className={cn('rounded-xl border border-fg-subtle/10 bg-bg-base overflow-hidden', className)}
    >
      {/* View toggle */}
      <div className="flex items-center justify-between border-b border-fg-subtle/10 px-4 py-2">
        <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
          <button
            type="button"
            onClick={() => setView('structured')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'structured'
                ? 'bg-bg-elevated text-fg-primary shadow-sm'
                : 'text-fg-secondary hover:text-fg-primary',
            )}
          >
            Structured
          </button>
          <button
            type="button"
            onClick={() => setView('raw')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'raw'
                ? 'bg-bg-elevated text-fg-primary shadow-sm'
                : 'text-fg-secondary hover:text-fg-primary',
            )}
          >
            Raw
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative p-4">
        {view === 'structured' ? (
          <StructuredView content={displayContent} />
        ) : (
          <RawView content={displayContent} />
        )}

        {/* Truncation fade */}
        {shouldTruncate ? (
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-bg-base to-transparent pt-16 pb-4">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-lg bg-bg-subtle px-3 py-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary transition-colors border border-fg-subtle/10"
            >
              Show full prompt ({lineCount} lines)
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
