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
vi.mock('~/lib/api', () => ({
  api: {
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

/** Fill the minimum required fields to make the form submittable (name + step instruction). */
function fillMinimumFields() {
  fireEvent.change(screen.getByPlaceholderText('e.g., Order Lookup'), {
    target: { value: 'Test SOP' },
  })
  fireEvent.change(screen.getByPlaceholderText('What should the agent do in this step?'), {
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
    expect(screen.getByText('Basic Information')).toBeInTheDocument()
    expect(screen.getByText('Trigger')).toBeInTheDocument()
    expect(screen.getByText('Steps')).toBeInTheDocument()
    expect(screen.getByText('Metadata')).toBeInTheDocument()
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

      expect(screen.getByLabelText('Trigger Type')).toHaveValue('manual')
    })

    it('shows channel checkboxes when channel trigger selected', () => {
      renderPage()

      fireEvent.change(screen.getByLabelText('Trigger Type'), { target: { value: 'channel' } })

      expect(screen.getByText('Channel Types')).toBeInTheDocument()
      expect(screen.getByLabelText('voice')).toBeInTheDocument()
      expect(screen.getByLabelText('chat')).toBeInTheDocument()
      expect(screen.getByLabelText('email')).toBeInTheDocument()
    })

    it('shows patterns input when intent_detected trigger selected', () => {
      renderPage()

      fireEvent.change(screen.getByLabelText('Trigger Type'), {
        target: { value: 'intent_detected' },
      })

      expect(screen.getByText('Patterns')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., where is my order')).toBeInTheDocument()
    })

    it('shows tool slugs input when tool_present trigger selected', () => {
      renderPage()

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
      fireEvent.change(screen.getByLabelText('Trigger Type'), { target: { value: 'channel' } })

      expect(getSubmitButton()).toBeDisabled()
    })

    it('enables submit when channel trigger has a checkbox selected', () => {
      renderPage()

      fillMinimumFields()

      fireEvent.change(screen.getByLabelText('Trigger Type'), { target: { value: 'channel' } })
      fireEvent.click(screen.getByLabelText('voice'))

      expect(getSubmitButton()).not.toBeDisabled()
    })

    it('disables submit when intent trigger has empty patterns', () => {
      renderPage()

      fillMinimumFields()

      fireEvent.change(screen.getByLabelText('Trigger Type'), {
        target: { value: 'intent_detected' },
      })

      expect(getSubmitButton()).toBeDisabled()
    })

    it('enables submit when intent trigger has a pattern', () => {
      renderPage()

      fillMinimumFields()

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
    it('starts with one empty step', () => {
      renderPage()

      expect(screen.getByText('Step 1')).toBeInTheDocument()
    })

    it('adds a new step when Add Step is clicked', () => {
      renderPage()

      fireEvent.click(screen.getByText('Add Step'))

      expect(screen.getByText('Step 1')).toBeInTheDocument()
      expect(screen.getByText('Step 2')).toBeInTheDocument()
    })

    it('generates unique step IDs after delete and re-add (critical bug fix)', () => {
      renderPage()

      // Add 2 more steps (3 total)
      fireEvent.click(screen.getByText('Add Step'))
      fireEvent.click(screen.getByText('Add Step'))

      // Type into each step to identify them
      const textareas = screen.getAllByPlaceholderText('What should the agent do in this step?')
      fireEvent.change(textareas[0], { target: { value: 'First' } })
      fireEvent.change(textareas[1], { target: { value: 'Second' } })
      fireEvent.change(textareas[2], { target: { value: 'Third' } })

      expect(screen.getAllByPlaceholderText('What should the agent do in this step?')).toHaveLength(
        3,
      )

      // Find and click the Trash2 button in the second step card.
      // Each step card has a required/optional toggle and optionally a delete button.
      // The delete buttons are the small icon buttons with type="button" inside step cards.
      const switches = screen.getAllByRole('switch')
      expect(switches).toHaveLength(3)

      // Delete the second step: find the delete button next to the 2nd toggle
      const secondToggle = switches[1]
      const secondStepHeader = secondToggle.parentElement
      const deleteBtn = secondStepHeader?.querySelector('button:not([role="switch"])')
      expect(deleteBtn).toBeTruthy()
      if (deleteBtn) fireEvent.click(deleteBtn)

      // Now we have 2 steps: "First" and "Third"
      expect(screen.getByDisplayValue('First')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Third')).toBeInTheDocument()
      expect(screen.getAllByPlaceholderText('What should the agent do in this step?')).toHaveLength(
        2,
      )

      // Add a new step — with the old bug, this would create a step with a duplicate
      // ID (step-3, same as the existing step), causing React key collision.
      // With the fix (useRef counter), it creates step-4 which is unique.
      fireEvent.click(screen.getByText('Add Step'))

      // Should have 3 steps again with no rendering issues
      expect(screen.getAllByPlaceholderText('What should the agent do in this step?')).toHaveLength(
        3,
      )
      expect(screen.getByText('Step 1')).toBeInTheDocument()
      expect(screen.getByText('Step 2')).toBeInTheDocument()
      expect(screen.getByText('Step 3')).toBeInTheDocument()
    })

    it('toggles step required/optional', () => {
      renderPage()

      expect(screen.getByText('Required')).toBeInTheDocument()

      const toggle = screen.getByRole('switch')
      fireEvent.click(toggle)

      expect(screen.getByText('Optional')).toBeInTheDocument()
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
      fireEvent.change(screen.getByPlaceholderText('What should the agent do in this step?'), {
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

  describe('metadata section', () => {
    it('starts collapsed', () => {
      renderPage()

      expect(screen.getByText('Show')).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('e.g., order, tracking, status')).not.toBeInTheDocument()
    })

    it('expands on click', () => {
      renderPage()

      fireEvent.click(screen.getByText('Show'))

      expect(screen.getByText('Hide')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., order, tracking, status')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., WISMO-001')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., 2-5 minutes')).toBeInTheDocument()
    })
  })
})
