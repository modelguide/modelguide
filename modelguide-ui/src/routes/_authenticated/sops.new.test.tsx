import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks ---

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({}),
    useSearch: () => ({}),
  }),
  useNavigate: () => mockNavigate,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

const mockPost = vi.fn()
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

vi.mock('~/lib/api', () => ({
  api: {
    get: (url: string) => ({
      json: () => {
        if (url === 'agents') return Promise.resolve(mockAgents)
        return Promise.resolve({ data: [] })
      },
    }),
    post: (...args: unknown[]) => {
      mockPost(...args)
      return {
        json: () =>
          Promise.resolve({
            id: '00000000-0000-0000-0000-000000000099',
            name: 'Test SOP',
          }),
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

const { Route } = await import('./sops.new')
// biome-ignore lint/suspicious/noExplicitAny: accessing internal Route.component for test rendering
const NewSopPage = (Route as any).component as React.ComponentType

function renderPage() {
  return render(<NewSopPage />, { wrapper })
}

/** Get all instruction textareas (always present in each step row). */
function getInstructionTextareas() {
  return screen.getAllByPlaceholderText('What should the agent do in this step?')
}

/** Fill the minimum required fields to make the form submittable (name + step instruction). */
function fillMinimumFields() {
  fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
    target: { value: 'Test SOP' },
  })
  fireEvent.change(getInstructionTextareas()[0], {
    target: { value: 'Do something' },
  })
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /Create SOP/i })
}

// --- Tests ---

describe('NewSopPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the create form with all sections', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Create SOP' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument()
    expect(screen.getByText('Steps')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Metadata' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agents' })).toBeInTheDocument()
  })

  it('auto-generates slug from name', () => {
    renderPage()

    fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
      target: { value: 'Order Lookup Flow' },
    })

    expect(screen.getByPlaceholderText('e.g., order-lookup')).toHaveValue('order-lookup-flow')
  })

  it('stops auto-generating slug after manual edit', () => {
    renderPage()

    const slugInput = screen.getByPlaceholderText('e.g., order-lookup')
    fireEvent.change(slugInput, { target: { value: 'custom-slug' } })

    fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
      target: { value: 'New Name' },
    })

    expect(slugInput).toHaveValue('custom-slug')
  })

  describe('trigger configuration', () => {
    it('defaults to manual trigger', () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))

      expect(screen.getByLabelText('Trigger Type')).toHaveValue('manual')
    })

    it('shows channel checkboxes when channel trigger selected', () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), { target: { value: 'channel' } })

      expect(screen.getByText('Channel Types')).toBeInTheDocument()
      expect(screen.getByLabelText('voice')).toBeInTheDocument()
      expect(screen.getByLabelText('chat')).toBeInTheDocument()
      expect(screen.getByLabelText('email')).toBeInTheDocument()
    })

    it('shows patterns input when intent_detected trigger selected', () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), {
        target: { value: 'intent_detected' },
      })

      expect(screen.getByText('Patterns')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., where is my order')).toBeInTheDocument()
    })

    it('shows tool slugs input when tool_present trigger selected', () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), {
        target: { value: 'tool_present' },
      })

      expect(screen.getByText('Tool Slugs')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., get_order')).toBeInTheDocument()
    })
  })

  describe('trigger validation', () => {
    it('disables submit when channel trigger has no checkboxes selected', () => {
      renderPage()

      fillMinimumFields()

      // Switch to channel trigger without checking any boxes
      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), { target: { value: 'channel' } })

      expect(getSubmitButton()).toBeDisabled()
    })

    it('enables submit when channel trigger has a checkbox selected', () => {
      renderPage()

      fillMinimumFields()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), { target: { value: 'channel' } })
      fireEvent.click(screen.getByLabelText('voice'))

      expect(getSubmitButton()).not.toBeDisabled()
    })

    it('disables submit when intent trigger has empty patterns', () => {
      renderPage()

      fillMinimumFields()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), {
        target: { value: 'intent_detected' },
      })

      expect(getSubmitButton()).toBeDisabled()
    })

    it('enables submit when intent trigger has a pattern', () => {
      renderPage()

      fillMinimumFields()

      fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
      fireEvent.change(screen.getByLabelText('Trigger Type'), {
        target: { value: 'intent_detected' },
      })
      fireEvent.change(screen.getByPlaceholderText('e.g., where is my order'), {
        target: { value: 'track order' },
      })

      expect(getSubmitButton()).not.toBeDisabled()
    })

    it('enables submit for manual trigger without extra config', () => {
      renderPage()

      fillMinimumFields()

      expect(getSubmitButton()).not.toBeDisabled()
    })
  })

  describe('steps management', () => {
    it('renders instruction textarea in step row', () => {
      renderPage()

      expect(getInstructionTextareas()).toHaveLength(1)
    })

    it('adds a new step when Add Step is clicked', () => {
      renderPage()

      fireEvent.change(getInstructionTextareas()[0], { target: { value: 'First step' } })
      fireEvent.click(screen.getByText('Add Step'))

      // Both steps have instruction textareas
      const textareas = getInstructionTextareas()
      expect(textareas).toHaveLength(2)
      expect(textareas[0]).toHaveValue('First step')
      expect(textareas[1]).toHaveValue('')
    })

    it('can add, delete, and re-add steps without crashes', () => {
      renderPage()

      fireEvent.change(getInstructionTextareas()[0], { target: { value: 'First step' } })

      fireEvent.click(screen.getByText('Add Step'))
      fireEvent.change(getInstructionTextareas()[1], { target: { value: 'Second step' } })

      fireEvent.click(screen.getByText('Add Step'))
      fireEvent.change(getInstructionTextareas()[2], { target: { value: 'Third step' } })

      expect(getInstructionTextareas()[0]).toHaveValue('First step')
      expect(getInstructionTextareas()[1]).toHaveValue('Second step')

      // Delete a step via trash button
      const trashButtons = screen
        .getAllByRole('button')
        .filter(
          (btn) => btn.querySelector('svg') !== null && btn.className.includes('hover:text-error'),
        )
      expect(trashButtons.length).toBeGreaterThanOrEqual(1)
      fireEvent.click(trashButtons[0])

      // Add another step — should not crash (unique ID regression test)
      fireEvent.click(screen.getByText('Add Step'))
      expect(getInstructionTextareas().length).toBeGreaterThanOrEqual(2)
    })

    it('toggles step required/optional via badge', () => {
      renderPage()

      // Compact row shows clickable "Req" badge
      expect(screen.getByRole('button', { name: 'Req' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Req' }))

      expect(screen.getByRole('button', { name: 'Opt' })).toBeInTheDocument()
    })
  })

  describe('form submission', () => {
    it('disables submit when name is empty', () => {
      renderPage()

      expect(getSubmitButton()).toBeDisabled()
    })

    it('disables submit when no steps have instructions', () => {
      renderPage()

      fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
        target: { value: 'Test SOP' },
      })

      expect(getSubmitButton()).toBeDisabled()
    })

    it('enables submit when name and step instruction are filled', () => {
      renderPage()

      fillMinimumFields()

      expect(getSubmitButton()).not.toBeDisabled()
    })

    it('submits correct data structure', async () => {
      renderPage()

      fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
        target: { value: 'Order Lookup' },
      })
      fireEvent.change(screen.getByPlaceholderText('What does this SOP do?'), {
        target: { value: 'Look up orders' },
      })
      fireEvent.change(getInstructionTextareas()[0], {
        target: { value: 'Ask for order number' },
      })

      fireEvent.click(getSubmitButton())

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('sops', {
          json: expect.objectContaining({
            name: 'Order Lookup',
            slug: 'order-lookup',
            description: 'Look up orders',
            definition: expect.objectContaining({
              schemaVersion: 1,
              trigger: { type: 'manual', config: {} },
              steps: [
                expect.objectContaining({
                  instruction: 'Ask for order number',
                  required: true,
                }),
              ],
            }),
          }),
        })
      })
    })

    it('navigates to detail page on successful creation', async () => {
      renderPage()

      fillMinimumFields()

      fireEvent.click(getSubmitButton())

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({
          to: '/sops/$id',
          params: { id: '00000000-0000-0000-0000-000000000099' },
        })
      })
    })
  })

  describe('agents section', () => {
    it('renders the agents tab', () => {
      renderPage()

      expect(screen.getByRole('button', { name: 'Agents' })).toBeInTheDocument()
    })

    it('shows available agents with checkboxes', async () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Agents' }))

      await waitFor(() => {
        expect(screen.getByText('Voice Agent')).toBeInTheDocument()
      })
      expect(screen.getByText('Chat Agent')).toBeInTheDocument()
    })

    it('toggles agent selection', async () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Agents' }))

      await waitFor(() => {
        expect(screen.getByText('Voice Agent')).toBeInTheDocument()
      })

      const voiceCheckbox = screen.getByText('Voice Agent').closest('label')?.querySelector('input')
      expect(voiceCheckbox).not.toBeChecked()

      if (voiceCheckbox) fireEvent.click(voiceCheckbox)
      expect(voiceCheckbox).toBeChecked()

      if (voiceCheckbox) fireEvent.click(voiceCheckbox)
      expect(voiceCheckbox).not.toBeChecked()
    })

    it('includes agentIds in submission', async () => {
      renderPage()

      fillMinimumFields()

      fireEvent.click(screen.getByRole('button', { name: 'Agents' }))

      await waitFor(() => {
        expect(screen.getByText('Voice Agent')).toBeInTheDocument()
      })

      const voiceCheckbox = screen.getByText('Voice Agent').closest('label')?.querySelector('input')
      if (voiceCheckbox) fireEvent.click(voiceCheckbox)

      fireEvent.click(getSubmitButton())

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith(
          'sops',
          expect.objectContaining({
            json: expect.objectContaining({
              agentIds: ['00000000-0000-0000-0000-aaaaaaaaaaaa'],
            }),
          }),
        )
      })
    })
  })

  describe('metadata section', () => {
    it('does not show metadata fields until tab is clicked', () => {
      renderPage()

      expect(screen.getByRole('button', { name: 'Metadata' })).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('e.g., order, tracking, status')).not.toBeInTheDocument()
    })

    it('shows metadata fields when Meta tab is clicked', () => {
      renderPage()

      fireEvent.click(screen.getByRole('button', { name: 'Metadata' }))

      expect(screen.getByPlaceholderText('e.g., order, tracking, status')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., WISMO-001')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., 2-5 minutes')).toBeInTheDocument()
    })
  })
})
