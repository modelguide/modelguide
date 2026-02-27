import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionMessage } from '~/schemas/sessions'
import { Transcript } from './transcript'

const makeMessage = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
  id: 'msg-1',
  sessionId: 'session-1',
  role: 'user',
  content: 'Hello there',
  createdAt: '2026-02-27T10:00:00Z',
  ...overrides,
})

describe('Transcript', () => {
  it('renders messages when provided', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hi' }),
      makeMessage({ id: 'msg-2', role: 'assistant', content: 'Hello!' }),
    ]

    render(<Transcript messages={messages} />)

    expect(screen.getByText('Hi')).toBeInTheDocument()
    expect(screen.getByText('Hello!')).toBeInTheDocument()
  })

  it('shows static empty state when no messages and not active', () => {
    render(<Transcript messages={[]} />)

    expect(screen.getByText('No messages in this session')).toBeInTheDocument()
    expect(screen.queryByText('Conversation in progress')).not.toBeInTheDocument()
  })

  it('shows static empty state when no messages and isActive is false', () => {
    render(<Transcript messages={[]} isActive={false} />)

    expect(screen.getByText('No messages in this session')).toBeInTheDocument()
  })

  it('shows waiting state when no messages and isActive is true', () => {
    render(<Transcript messages={[]} isActive />)

    expect(screen.getByText('Conversation in progress')).toBeInTheDocument()
    expect(screen.getByText('Details will appear when messages arrive')).toBeInTheDocument()
    expect(screen.queryByText('No messages in this session')).not.toBeInTheDocument()
  })

  it('renders messages even when isActive is true', () => {
    const messages = [makeMessage({ id: 'msg-1', content: 'Test message' })]

    render(<Transcript messages={messages} isActive />)

    expect(screen.getByText('Test message')).toBeInTheDocument()
    expect(screen.queryByText('Conversation in progress')).not.toBeInTheDocument()
  })
})
