import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DangerZoneCard } from './danger-zone-card'

// Mock the dialog element methods (jsdom doesn't support showModal/close)
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

const mockDelete = vi.fn()
vi.mock('~/lib/api', () => ({
  api: {
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('DangerZoneCard', () => {
  const onDeleted = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the danger zone card', () => {
    render(<DangerZoneCard sopId="sop-1" sopName="Order Lookup" onDeleted={onDeleted} />, {
      wrapper,
    })

    expect(screen.getByText('Danger Zone')).toBeInTheDocument()
    expect(screen.getByText('Delete SOP')).toBeInTheDocument()
    expect(screen.getByText(/Permanently delete this SOP/)).toBeInTheDocument()
  })

  it('opens confirmation dialog when delete button is clicked', () => {
    render(<DangerZoneCard sopId="sop-1" sopName="Order Lookup" onDeleted={onDeleted} />, {
      wrapper,
    })

    fireEvent.click(screen.getByText('Delete SOP'))

    expect(screen.getByText(/Are you sure you want to delete "Order Lookup"/)).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('calls API delete on confirm', async () => {
    mockDelete.mockResolvedValueOnce({})

    render(<DangerZoneCard sopId="sop-1" sopName="Test SOP" onDeleted={onDeleted} />, {
      wrapper,
    })

    // Open dialog
    fireEvent.click(screen.getByText('Delete SOP'))

    // Click confirm delete
    fireEvent.click(screen.getByText('Delete'))

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('sops/sop-1')
    })

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled()
    })
  })
})
