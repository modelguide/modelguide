import { diffLines } from 'diff'
import { useMemo } from 'react'
import { cn } from '~/lib/cn'

interface PromptDiffViewerProps {
  oldContent: string
  newContent: string
  className?: string
}

interface DiffLine {
  text: string
  type: 'added' | 'removed' | 'unchanged'
  lineNum: number | null
}

export function PromptDiffViewer({ oldContent, newContent, className }: PromptDiffViewerProps) {
  const {
    diffLines: computedLines,
    addedCount,
    removedCount,
  } = useMemo(() => {
    const changes = diffLines(oldContent, newContent)
    const lines: DiffLine[] = []
    let added = 0
    let removed = 0
    let num = 0

    for (const change of changes) {
      // Strip single trailing newline to avoid phantom empty line
      const raw = change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value
      const parts = raw.split('\n')

      for (const part of parts) {
        const type: DiffLine['type'] = change.added
          ? 'added'
          : change.removed
            ? 'removed'
            : 'unchanged'
        if (!change.removed) num++
        lines.push({ text: part, type, lineNum: change.removed ? null : num })
        if (change.added) added++
        if (change.removed) removed++
      }
    }

    return { diffLines: lines, addedCount: added, removedCount: removed }
  }, [oldContent, newContent])

  return (
    <div
      className={cn(
        'rounded-xl border border-fg-subtle/10 bg-bg-base overflow-hidden font-mono text-[13px]',
        className,
      )}
    >
      {/* Stats header */}
      <div className="flex items-center gap-3 border-b border-fg-subtle/10 px-4 py-2 bg-bg-elevated">
        <span className="text-success text-xs font-medium">+{addedCount}</span>
        <span className="text-error text-xs font-medium">-{removedCount}</span>
        <span className="text-fg-muted text-xs">lines changed</span>
      </div>

      {/* Diff lines */}
      <div className="overflow-y-auto">
        {computedLines.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are computed once per content pair, order is stable
            key={i}
            className={cn(
              'flex border-l-2 px-4 py-0.5 leading-5',
              line.type === 'added' && 'bg-success/[0.06] border-success/40 text-success',
              line.type === 'removed' &&
                'bg-error/[0.06] border-error/40 text-error line-through decoration-error/30',
              line.type === 'unchanged' && 'border-transparent text-fg-muted',
            )}
          >
            <span className="w-10 shrink-0 text-right pr-3 select-none opacity-50">
              {line.lineNum ?? ''}
            </span>
            <span className="w-5 shrink-0 select-none opacity-60">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            <pre className="whitespace-pre-wrap break-words min-w-0">{line.text || '\u200b'}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}
