import { MessageCircle } from 'lucide-react'
import type { SessionMessage } from '~/schemas/sessions'
import { TranscriptMessage } from './transcript-message'

export interface TranscriptProps {
  messages: SessionMessage[]
}

export function Transcript({ messages }: TranscriptProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 rounded-full bg-fg-subtle/10 p-4">
          <MessageCircle className="h-8 w-8 text-fg-muted" />
        </div>
        <p className="font-sans text-sm text-fg-muted">No messages in this session</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      {messages.map((message) => (
        <TranscriptMessage key={message.id} message={message} />
      ))}
    </div>
  )
}
