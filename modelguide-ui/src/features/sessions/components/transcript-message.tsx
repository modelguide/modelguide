import { Bot, User } from 'lucide-react'
import { cn } from '~/lib/cn'
import type { SessionMessage } from '~/schemas/sessions'
import { ToolCallBlock } from './tool-call-block'

export interface TranscriptMessageProps {
  message: SessionMessage
}

export function TranscriptMessage({ message }: TranscriptMessageProps) {
  // Skip assistant messages that are tool-call initiators (no visible content)
  if (message.role === 'assistant' && !message.content && message.toolCallId) {
    return null
  }

  if (message.role === 'tool') {
    return (
      <ToolCallBlock
        toolName={message.toolName || 'unknown'}
        input={message.toolInput || {}}
        output={message.toolOutput || {}}
        status={message.toolStatus ?? 'success'}
        latencyMs={message.latencyMs || 0}
      />
    )
  }

  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-brand/20 text-brand' : 'bg-fg-subtle/20 text-fg-secondary',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Message bubble */}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-3',
          isUser
            ? 'rounded-br-md bg-brand text-white'
            : 'rounded-bl-md bg-bg-subtle text-fg-primary',
        )}
      >
        <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{message.content}</p>
        {message.latencyMs || message.modelUsed ? (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-2 text-[10px]',
              isUser ? 'text-white/50' : 'text-fg-muted',
            )}
          >
            {message.latencyMs ? <span>{message.latencyMs}ms</span> : null}
            {message.modelUsed ? <span>{message.modelUsed}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
