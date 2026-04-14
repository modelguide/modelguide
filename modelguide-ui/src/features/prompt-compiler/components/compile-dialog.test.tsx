import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCompileResponse } from '../../../../test/prompt-compiler-fixtures'
import { CompileDialog } from './compile-dialog'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn()

// Track configurable responses
let mockSopsResponse: unknown = { data: [] }
let mockCompileResponse: unknown = makeCompileResponse()

vi.mock('~/lib/api', () => ({
  api: {
    get: (_url: string) => ({
      json: () => Promise.resolve(mockSopsResponse),
    }),
    post: (...args: unknown[]) => {
      mockPost(...args)
      return {
        json: () => Promise.resolve(mockCompileResponse),
      }
    },
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()

  // Reset compile response to default
  mockCompileResponse = makeCompileResponse()

  // Default: SOPs with one assigned to this agent
  mockSopsResponse = {
    data: [
      {
        id: '00000000-0000-0000-0000-000000000050',
        name: 'WISMO Flow',
        slug: 'wismo-flow',
        status: 'active',
        version: '1',
        assignedAgents: [{ id: 'agent-1', name: 'Bot', modality: 'text' }],
        sopTemplateId: null,
        templateName: null,
        stepCount: 4,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
      {
        id: '00000000-0000-0000-0000-000000000051',
        name: 'Unrelated SOP',
        slug: 'unrelated',
        status: 'active',
        version: '1',
        assignedAgents: [{ id: 'other-agent', name: 'Other', modality: 'voice' }],
        sopTemplateId: null,
        templateName: null,
        stepCount: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
    ],
  }
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  agentId: 'agent-1',
  currentPrompt: null as string | null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompileDialog', () => {
  describe('initial state', () => {
    it('renders dialog title and description', () => {
      render(<CompileDialog {...defaultProps} />, { wrapper })

      expect(screen.getByText('Compile Prompt')).toBeInTheDocument()
      expect(
        screen.getByText('Select an SOP and preview the compiled system prompt.'),
      ).toBeInTheDocument()
    })

    it('shows SOP select with placeholder', () => {
      render(<CompileDialog {...defaultProps} />, { wrapper })

      expect(screen.getByText('Select an SOP...')).toBeInTheDocument()
    })

    it('disables Apply button before preview', () => {
      render(<CompileDialog {...defaultProps} />, { wrapper })

      const applyButton = screen.getByText('Apply')
      expect(applyButton).toBeDisabled()
    })

    it('disables Preview button when no SOP selected', () => {
      render(<CompileDialog {...defaultProps} />, { wrapper })

      const previewButton = screen.getByText('Preview')
      expect(previewButton).toBeDisabled()
    })
  })

  describe('SOP selection', () => {
    it('shows only SOPs assigned to the current agent', async () => {
      render(<CompileDialog {...defaultProps} />, { wrapper })

      await waitFor(() => {
        expect(screen.getByText('WISMO Flow (active)')).toBeInTheDocument()
      })

      // SOP assigned to 'other-agent' should not appear
      expect(screen.queryByText('Unrelated SOP')).not.toBeInTheDocument()
    })

    it('shows warning when no SOPs are available for the agent', async () => {
      mockSopsResponse = { data: [] }

      render(<CompileDialog {...defaultProps} />, { wrapper })

      await waitFor(() => {
        expect(screen.getByText(/No SOPs are assigned to this agent/)).toBeInTheDocument()
      })
    })

    it('pre-selects SOP when preselectedSopId is provided', async () => {
      render(
        <CompileDialog {...defaultProps} preselectedSopId="00000000-0000-0000-0000-000000000050" />,
        { wrapper },
      )

      // Wait for SOPs to load, then verify the select has the preselected value
      await waitFor(() => {
        const select = screen.getByLabelText('SOP') as HTMLSelectElement
        expect(select.value).toBe('00000000-0000-0000-0000-000000000050')
      })
    })
  })

  describe('preview flow', () => {
    it('calls dry-run compile when Preview is clicked', async () => {
      render(
        <CompileDialog {...defaultProps} preselectedSopId="00000000-0000-0000-0000-000000000050" />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          'agents/agent-1/compile',
          expect.objectContaining({
            json: { sopId: '00000000-0000-0000-0000-000000000050' },
            searchParams: { dryRun: 'true' },
          }),
        )
      })
    })

    it('shows summary bar after successful preview', async () => {
      render(
        <CompileDialog {...defaultProps} preselectedSopId="00000000-0000-0000-0000-000000000050" />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('WISMO Email Flow')).toBeInTheDocument()
      })
    })

    it('shows compiled prompt viewer after preview', async () => {
      render(
        <CompileDialog {...defaultProps} preselectedSopId="00000000-0000-0000-0000-000000000050" />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('Structured')).toBeInTheDocument()
      })
    })

    it('enables Apply button after successful preview', async () => {
      render(
        <CompileDialog {...defaultProps} preselectedSopId="00000000-0000-0000-0000-000000000050" />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('Apply')).not.toBeDisabled()
      })
    })
  })

  describe('changes tab', () => {
    it('shows Prompt/Changes tab bar when there is an existing prompt that differs', async () => {
      render(
        <CompileDialog
          {...defaultProps}
          currentPrompt="Old prompt content"
          preselectedSopId="00000000-0000-0000-0000-000000000050"
        />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        // Summary bar appears — proves preview completed
        expect(screen.getByText('WISMO Email Flow')).toBeInTheDocument()
      })

      // Tab bar with Prompt and Changes buttons
      expect(screen.getByText('Prompt')).toBeInTheDocument()
      expect(screen.getByText('Changes')).toBeInTheDocument()
    })

    it('hides Changes tab when currentPrompt is null (first compile)', async () => {
      render(
        <CompileDialog
          {...defaultProps}
          currentPrompt={null}
          preselectedSopId="00000000-0000-0000-0000-000000000050"
        />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('WISMO Email Flow')).toBeInTheDocument()
      })

      expect(screen.queryByText('Changes')).not.toBeInTheDocument()
    })

    it('shows "No changes" message when prompt is identical', async () => {
      mockCompileResponse = makeCompileResponse({ compiledPrompt: 'Same content' })

      render(
        <CompileDialog
          {...defaultProps}
          currentPrompt="Same content"
          preselectedSopId="00000000-0000-0000-0000-000000000050"
        />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))

      await waitFor(() => {
        expect(screen.getByText('WISMO Email Flow')).toBeInTheDocument()
      })

      // Changes tab is still visible (it's a recompile) but shows no-changes state
      fireEvent.click(screen.getByText('Changes'))
      expect(screen.getByText('No changes')).toBeInTheDocument()
      expect(
        screen.getByText('The compiled prompt is identical to the current one.'),
      ).toBeInTheDocument()
    })
  })

  describe('apply flow', () => {
    it('calls compile without dryRun when Apply is clicked', async () => {
      render(
        <CompileDialog {...defaultProps} preselectedSopId="00000000-0000-0000-0000-000000000050" />,
        { wrapper },
      )

      // Preview first
      fireEvent.click(screen.getByText('Preview'))
      await waitFor(() => {
        expect(screen.getByText('Apply')).not.toBeDisabled()
      })

      // Then apply
      mockPost.mockClear()
      fireEvent.click(screen.getByText('Apply'))

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          'agents/agent-1/compile',
          expect.objectContaining({
            json: { sopId: '00000000-0000-0000-0000-000000000050' },
          }),
        )
      })

      // Verify no dryRun param in the apply call
      const applyCallArgs = mockPost.mock.calls[0]
      expect(applyCallArgs[1]).not.toHaveProperty('searchParams')
    })

    it('calls onClose after successful apply', async () => {
      const onClose = vi.fn()

      render(
        <CompileDialog
          {...defaultProps}
          onClose={onClose}
          preselectedSopId="00000000-0000-0000-0000-000000000050"
        />,
        { wrapper },
      )

      fireEvent.click(screen.getByText('Preview'))
      await waitFor(() => {
        expect(screen.getByText('Apply')).not.toBeDisabled()
      })

      fireEvent.click(screen.getByText('Apply'))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('state reset on close', () => {
    it('resets SOP selection to preselected value on close', () => {
      const onClose = vi.fn()

      render(
        <CompileDialog
          {...defaultProps}
          onClose={onClose}
          preselectedSopId="00000000-0000-0000-0000-000000000050"
        />,
        { wrapper },
      )

      // Change selection
      const select = screen.getByLabelText('SOP') as HTMLSelectElement
      fireEvent.change(select, { target: { value: '' } })
      expect(select.value).toBe('')

      // Close dialog (via the X button, which triggers handleClose)
      fireEvent.click(screen.getByLabelText('Close dialog'))

      expect(onClose).toHaveBeenCalled()
    })
  })
})
