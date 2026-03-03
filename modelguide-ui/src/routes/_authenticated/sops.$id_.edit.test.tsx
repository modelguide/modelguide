import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SopDetail } from '~/schemas/sops'

// --- Mock SOP data ---

const mockAgents = {
  data: [
    { id: '00000000-0000-0000-0000-aaaaaaaaaaaa', name: 'Voice Agent', modality: 'voice' },
    { id: '00000000-0000-0000-0000-bbbbbbbbbbbb', name: 'Chat Agent', modality: 'text' },
  ],
  pagination: {
    page: 1,
    pageSize: 50,
    totalItems: 2,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
}

const mockSop: SopDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Order Lookup',
  slug: 'order-lookup',
  description: 'Look up customer orders',
  status: 'draft',
  version: '1',
  assignedAgents: [
    { id: '00000000-0000-0000-0000-aaaaaaaaaaaa', name: 'Voice Agent', modality: 'voice' },
  ],
  sopTemplateId: null,
  template: null,
  definition: {
    schemaVersion: 1,
    trigger: {
      type: 'intent_detected',
      config: { patterns: ['where is my order', 'track order'] },
    },
    steps: [
      {
        id: 'step-1',
        order: 1,
        instruction: 'Ask for order number',
        required: true,
        notes: 'Be polite',
      },
      {
        id: 'step-2',
        order: 2,
        instruction: 'Look up the order',
        required: true,
        tool: { connectorToolId: '00000000-0000-0000-0000-000000000099' },
      },
    ],
    metadata: {
      tags: ['order', 'tracking'],
      reasonCode: 'WISMO-001',
      estimatedDuration: '2-5 minutes',
    },
  },
  stepWarnings: [],
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
}

// --- Mocks ---

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ id: '00000000-0000-0000-0000-000000000001' }),
    useSearch: () => ({}),
  }),
  useNavigate: () => mockNavigate,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

const mockPatch = vi.fn()
const mockGet = vi.fn()

vi.mock('~/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => {
      mockGet(...args)
      return {
        json: () => {
          const url = args[0] as string
          if (url === 'agents') return Promise.resolve(mockAgents)
          return Promise.resolve(mockSop)
        },
      }
    },
    patch: (...args: unknown[]) => {
      mockPatch(...args)
      return {
        json: () => Promise.resolve(mockSop),
      }
    },
  },
}))

// --- Helpers ---

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const { Route } = await import('./sops.$id_.edit')
// biome-ignore lint/suspicious/noExplicitAny: accessing internal Route.component for test rendering
const EditSopPage = (Route as any).component as React.ComponentType

function renderPage() {
  return render(<EditSopPage />, { wrapper })
}

// --- Tests ---

describe('EditSopPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the edit form with correct heading', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit SOP' })).toBeInTheDocument()
    })
  })

  it('pre-fills the name field', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., Order Lookup')).toHaveValue('Order Lookup')
    })
  })

  it('pre-fills and disables the slug field', async () => {
    renderPage()

    await waitFor(() => {
      const slugInput = screen.getByPlaceholderText('e.g., order-lookup')
      expect(slugInput).toHaveValue('order-lookup')
      expect(slugInput).toBeDisabled()
    })

    expect(screen.getByText('Cannot change slug after creation')).toBeInTheDocument()
  })

  it('pre-fills the description', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('What does this SOP do?')).toHaveValue(
        'Look up customer orders',
      )
    })
  })

  it('pre-fills the trigger type', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit SOP' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Trigger Type')).toHaveValue('intent_detected')
    })
  })

  it('pre-fills trigger patterns', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit SOP' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('where is my order')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('track order')).toBeInTheDocument()
  })

  it('pre-fills step instructions in textareas', async () => {
    renderPage()

    // Steps always show instruction in a textarea
    await waitFor(() => {
      expect(screen.getByDisplayValue('Ask for order number')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('Look up the order')).toBeInTheDocument()
  })

  it('shows step details when expanded', async () => {
    renderPage()

    // Wait for steps to load
    await waitFor(() => {
      expect(screen.getByDisplayValue('Ask for order number')).toBeInTheDocument()
    })

    // Click the expand chevron on the first step
    const expandButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.querySelector('svg.lucide-chevron-down') !== null)
    fireEvent.click(expandButtons[0])

    // Notes field should now be visible
    await waitFor(() => {
      expect(screen.getByDisplayValue('Be polite')).toBeInTheDocument()
    })
  })

  it('shows metadata when Meta tab is clicked', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit SOP' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('order, tracking')).toBeInTheDocument()
    })

    expect(screen.getByDisplayValue('WISMO-001')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2-5 minutes')).toBeInTheDocument()
  })

  it('uses Save Changes as submit label', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument()
    })
  })

  it('calls PATCH on submit', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., Order Lookup')).toHaveValue('Order Lookup')
    })

    // Change the name
    fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
      target: { value: 'Updated SOP Name' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        'sops/00000000-0000-0000-0000-000000000001',
        expect.objectContaining({
          json: expect.objectContaining({
            name: 'Updated SOP Name',
          }),
        }),
      )
    })
  })

  it('sends definition in PATCH payload', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., Order Lookup')).toHaveValue('Order Lookup')
    })

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        'sops/00000000-0000-0000-0000-000000000001',
        expect.objectContaining({
          json: expect.objectContaining({
            definition: expect.objectContaining({
              schemaVersion: 1,
              trigger: expect.objectContaining({ type: 'intent_detected' }),
              steps: expect.arrayContaining([
                expect.objectContaining({ instruction: 'Ask for order number' }),
              ]),
            }),
          }),
        }),
      )
    })
  })

  it('pre-selects assigned agents', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit SOP' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))

    await waitFor(() => {
      expect(screen.getByText('Voice Agent')).toBeInTheDocument()
    })

    const voiceCheckbox = screen.getByText('Voice Agent').closest('label')?.querySelector('input')
    const chatCheckbox = screen.getByText('Chat Agent').closest('label')?.querySelector('input')

    expect(voiceCheckbox).toBeChecked()
    expect(chatCheckbox).not.toBeChecked()
  })

  it('does not include agentIds in PATCH payload (managed via dedicated dialog)', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., Order Lookup')).toHaveValue('Order Lookup')
    })

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled()
    })

    const payload = mockPatch.mock.calls[0][1] as { json: Record<string, unknown> }
    expect(payload.json).not.toHaveProperty('agentIds')
  })

  it('does not send slug in PATCH payload', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., Order Lookup')).toHaveValue('Order Lookup')
    })

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled()
    })

    const patchPayload = mockPatch.mock.calls[0][1].json
    expect(patchPayload).not.toHaveProperty('slug')
  })
})
