import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks ---

vi.mock('~/lib/utils', () => ({
  formatDate: (date: string) => date,
  formatDuration: (seconds: number) => `${Math.round(seconds)}s`,
}))

vi.mock('~/lib/cn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

const mockSessions = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    externalId: 'ext-1',
    agent: { id: 'agent-1', name: 'Test Agent' },
    channelType: 'voice',
    status: 'completed',
    mode: 'live',
    userIdentifier: 'customer@example.com',
    startedAt: '2026-03-20T10:00:00Z',
    endedAt: '2026-03-20T10:05:00Z',
    durationSeconds: 300,
    messageCount: 12,
    feedbackSummary: { hasFeedback: false, customerRating: null, supportRating: null },
    sopClassification: null,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    externalId: 'ext-2',
    agent: { id: 'agent-1', name: 'Test Agent' },
    channelType: 'chat',
    status: 'completed',
    mode: 'live',
    userIdentifier: 'user2@example.com',
    startedAt: '2026-03-19T14:00:00Z',
    endedAt: '2026-03-19T14:10:00Z',
    durationSeconds: 600,
    messageCount: 20,
    feedbackSummary: { hasFeedback: false, customerRating: null, supportRating: null },
    sopClassification: null,
  },
]

let shouldReturnSessions = true

vi.mock('~/lib/api', () => ({
  api: {
    get: (url: string) => ({
      json: () => {
        if (url.startsWith('sessions')) {
          return Promise.resolve({
            data: shouldReturnSessions ? mockSessions : [],
            pagination: {
              page: 1,
              pageSize: 10,
              totalItems: shouldReturnSessions ? mockSessions.length : 0,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          })
        }
        return Promise.resolve({})
      },
    }),
    post: () => ({
      json: () =>
        Promise.resolve({
          id: 'run-1',
          suiteId: 'suite-1',
          passed: true,
          promptSource: 'compiled',
          startedAt: '2026-03-20T10:00:00Z',
          completedAt: '2026-03-20T10:00:01Z',
          durationMs: 1234,
          metadata: null,
          testCaseResults: [],
        }),
    }),
  },
}))

// Mock dialog methods
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

import { RunSuiteDialog } from './run-suite-dialog'

function renderDialog(props: Partial<React.ComponentProps<typeof RunSuiteDialog>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    suiteId: '00000000-0000-0000-0000-d00000000001',
    ...props,
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <RunSuiteDialog {...defaultProps} />
    </QueryClientProvider>,
  )
}

// --- Tests ---

describe('RunSuiteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shouldReturnSessions = true
  })

  it('renders dialog title and session ID input', () => {
    renderDialog()

    expect(screen.getByText('Run Eval Suite')).toBeInTheDocument()
    expect(screen.getByLabelText('Session ID')).toBeInTheDocument()
  })

  it('renders prompt source selector with options', () => {
    renderDialog()

    expect(screen.getByLabelText('Prompt Source')).toBeInTheDocument()
    expect(screen.getByText('Compiled')).toBeInTheDocument()
  })

  it('disables Run Suite button when no session ID', () => {
    renderDialog()

    const button = screen.getByText('Run Suite')
    expect(button).toBeDisabled()
  })

  it('shows validation warning for invalid UUID', () => {
    renderDialog()

    const input = screen.getByLabelText('Session ID')
    fireEvent.change(input, { target: { value: 'not-a-uuid' } })

    expect(screen.getByText('Enter a valid UUID')).toBeInTheDocument()
  })

  it('enables Run Suite button when valid UUID is entered', () => {
    renderDialog()

    const input = screen.getByLabelText('Session ID')
    fireEvent.change(input, { target: { value: '11111111-1111-1111-1111-111111111111' } })

    const button = screen.getByText('Run Suite')
    expect(button).not.toBeDisabled()
  })

  it('shows recent sessions when agentId is provided', async () => {
    await act(async () => {
      renderDialog({ agentId: 'agent-1' })
    })

    await waitFor(() => {
      expect(screen.getByText('customer@example.com')).toBeInTheDocument()
    })

    expect(screen.getByText('Recent Sessions')).toBeInTheDocument()
    expect(screen.getByText('user2@example.com')).toBeInTheDocument()
  })

  it('fills session ID when clicking a recent session', async () => {
    await act(async () => {
      renderDialog({ agentId: 'agent-1' })
    })

    await waitFor(() => {
      expect(screen.getByText('customer@example.com')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('customer@example.com'))

    const input = screen.getByLabelText('Session ID') as HTMLInputElement
    expect(input.value).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('does not show recent sessions when agentId is not provided', () => {
    renderDialog({ agentId: undefined })

    expect(screen.queryByText('Recent Sessions')).not.toBeInTheDocument()
  })

  it('does not show recent sessions when there are none', async () => {
    shouldReturnSessions = false

    await act(async () => {
      renderDialog({ agentId: 'agent-1' })
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading sessions…')).not.toBeInTheDocument()
    })

    expect(screen.queryByText('Recent Sessions')).not.toBeInTheDocument()
  })

  it('shows session duration and status', async () => {
    await act(async () => {
      renderDialog({ agentId: 'agent-1' })
    })

    await waitFor(() => {
      expect(screen.getByText('customer@example.com')).toBeInTheDocument()
    })

    // Status badges
    expect(screen.getAllByText('completed')).toHaveLength(2)
    // Duration
    expect(screen.getByText('300s')).toBeInTheDocument()
    expect(screen.getByText('600s')).toBeInTheDocument()
  })
})
