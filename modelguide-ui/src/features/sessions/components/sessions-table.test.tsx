import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionsTable } from './sessions-table'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

describe('SessionsTable', () => {
  it('keeps long SOP labels on a single badge with a title for the full value', () => {
    const longSopName = 'Customer Returns and Exchange Escalation Workflow for Premium Orders'

    render(
      <SessionsTable
        sessions={[
          {
            id: 'session-1',
            externalId: 'ext-1',
            agent: { id: 'agent-1', name: 'Support Agent' },
            channelType: 'email',
            status: 'completed',
            mode: 'live',
            userIdentifier: 'customer@example.com',
            userMetadata: {},
            startedAt: '2026-03-23T10:00:00.000Z',
            endedAt: '2026-03-23T10:05:00.000Z',
            durationSeconds: 300,
            totalTokens: 1200,
            costUsd: 0.0123,
            metadata: {},
            messageCount: 8,
            feedbackSummary: {
              hasFeedback: true,
              customerRating: 2,
              supportRating: 2,
            },
            sopClassification: {
              sopSlug: 'returns-escalation',
              sopName: longSopName,
              confidence: 0.92,
            },
          },
        ]}
      />,
    )

    expect(screen.getByText(longSopName)).toBeInTheDocument()
    expect(screen.getByTitle(longSopName)).toBeInTheDocument()
  })
})
