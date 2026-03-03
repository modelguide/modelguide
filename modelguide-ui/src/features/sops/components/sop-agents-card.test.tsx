import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAssignedAgent } from '../../../../test/sop-fixtures'
import { SopAgentsCard } from './sop-agents-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
  }: { children: React.ReactNode; className?: string; to?: string; params?: unknown }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

// Mock the dialog element methods (jsdom doesn't support showModal/close)
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

vi.mock('~/lib/api', () => ({
  api: {
    get: vi.fn().mockReturnValue({
      json: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
    }),
    put: vi.fn().mockReturnValue({
      json: () => Promise.resolve({}),
    }),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('SopAgentsCard', () => {
  it('renders empty state when no agents', () => {
    render(<SopAgentsCard sopId="sop-1" agents={[]} canMutate={false} />, { wrapper })

    expect(screen.getByText(/Assigned Agents/)).toBeInTheDocument()
    expect(screen.getByText('No agents assigned to this SOP')).toBeInTheDocument()
  })

  it('renders agent list with names and modality', () => {
    const agents = [
      makeAssignedAgent({ id: 'a1', name: 'Support Bot', modality: 'text' }),
      makeAssignedAgent({ id: 'a2', name: 'Voice Agent', modality: 'voice' }),
    ]

    render(<SopAgentsCard sopId="sop-1" agents={agents} canMutate={false} />, { wrapper })

    expect(screen.getByText('Support Bot')).toBeInTheDocument()
    expect(screen.getByText('Voice Agent')).toBeInTheDocument()
    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText('voice')).toBeInTheDocument()
  })

  it('shows Manage button when canMutate is true', () => {
    render(<SopAgentsCard sopId="sop-1" agents={[]} canMutate />, { wrapper })

    expect(screen.getByText('Manage')).toBeInTheDocument()
  })

  it('hides Manage button when canMutate is false', () => {
    render(<SopAgentsCard sopId="sop-1" agents={[]} canMutate={false} />, { wrapper })

    expect(screen.queryByText('Manage')).not.toBeInTheDocument()
  })

  it('opens agent picker dialog when Manage is clicked', () => {
    render(<SopAgentsCard sopId="sop-1" agents={[]} canMutate />, { wrapper })

    fireEvent.click(screen.getByText('Manage'))

    expect(screen.getByText('Manage Agent Assignments')).toBeInTheDocument()
  })

  it('shows correct agent count in header', () => {
    const agents = [
      makeAssignedAgent({ id: 'a1', name: 'Bot A' }),
      makeAssignedAgent({ id: 'a2', name: 'Bot B' }),
    ]

    render(<SopAgentsCard sopId="sop-1" agents={agents} canMutate={false} />, { wrapper })

    expect(screen.getByText(/Assigned Agents \(2\)/)).toBeInTheDocument()
  })
})
