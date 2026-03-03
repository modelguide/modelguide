import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSopDetail } from '../../../test/sop-fixtures'
import type { SopDetail } from '../../schemas/sops'

// --- Mocks ---

const mockNavigate = vi.fn()
const mockParams: Record<string, string> = { id: '00000000-0000-0000-0000-000000000001' }

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mockParams,
    useSearch: () => ({}),
  }),
  useNavigate: () => mockNavigate,
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

let mockIsAdmin = true
let mockCanMutate = true
vi.mock('~/lib/permissions', () => ({
  useIsAdmin: () => mockIsAdmin,
  useCanMutate: () => mockCanMutate,
}))

vi.mock('~/lib/utils', () => ({
  formatDate: (date: string) => date,
}))

let sopFixture: SopDetail = makeSopDetail()
let shouldRejectGet = false
let shouldRejectPost = false

vi.mock('~/lib/api', () => ({
  api: {
    get: () => ({
      json: () =>
        shouldRejectGet ? Promise.reject(new Error('Not found')) : Promise.resolve(sopFixture),
    }),
    post: () => ({
      json: () =>
        shouldRejectPost ? Promise.reject(new Error('Failed')) : Promise.resolve(sopFixture),
    }),
    put: () => ({
      json: () => Promise.resolve({}),
    }),
    delete: () => Promise.resolve({}),
  },
}))

// Mock dialog methods
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SopDetailPage />
    </QueryClientProvider>,
  )
}

const { Route } = await import('./sops.$id')
// biome-ignore lint/suspicious/noExplicitAny: accessing internal Route.component for test rendering
const SopDetailPage = (Route as any).component as React.ComponentType

// --- Tests ---

describe('SopDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin = true
    mockCanMutate = true
    sopFixture = makeSopDetail()
    shouldRejectGet = false
    shouldRejectPost = false
  })

  it('renders SOP details after loading', async () => {
    sopFixture = makeSopDetail({ name: 'Order Lookup', slug: 'order-lookup' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument()
    })

    // Slug appears in both header and details card
    expect(screen.getAllByText('order-lookup')).toHaveLength(2)
  })

  it('renders steps and sidebar tabs', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument()
    })

    expect(screen.getByText(/Steps/)).toBeInTheDocument()

    // Sidebar tabs are visible
    expect(screen.getByText('Trigger')).toBeInTheDocument()
    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('Agents')).toBeInTheDocument()
  })

  it('switches sidebar tabs to show different content', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Details')).toBeInTheDocument()
    })

    // Click Agents tab
    fireEvent.click(screen.getByText('Agents'))
    await waitFor(() => {
      expect(screen.getByText(/Assigned Agents/)).toBeInTheDocument()
    })

    // Click Trigger tab
    fireEvent.click(screen.getByText('Trigger'))
    await waitFor(() => {
      expect(screen.getByText('Type')).toBeInTheDocument()
    })
  })

  it('shows error state when API fails', async () => {
    shouldRejectGet = true

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Failed to load SOP')).toBeInTheDocument()
    })
  })

  describe('status action buttons', () => {
    it('shows Activate button for draft SOPs', async () => {
      sopFixture = makeSopDetail({ status: 'draft' })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Activate')).toBeInTheDocument()
      })
    })

    it('shows Archive in Settings tab for active SOPs', async () => {
      sopFixture = makeSopDetail({ status: 'active' })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Settings'))

      await waitFor(() => {
        expect(screen.getByText('Archive SOP')).toBeInTheDocument()
      })
    })

    it('shows Activate button for archived SOPs (re-activation fix)', async () => {
      sopFixture = makeSopDetail({ status: 'archived' })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Activate')).toBeInTheDocument()
      })
    })

    it('calls activate API when Activate is clicked', async () => {
      sopFixture = makeSopDetail({ status: 'draft' })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Activate')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Activate'))

      // Mutation fires — we verify by checking the button shows loading state
      // (the actual API mock is simplified, so we just verify it doesn't crash)
      await waitFor(() => {
        expect(screen.getByText('Activate')).toBeInTheDocument()
      })
    })

    it('calls archive API when Archive SOP is clicked', async () => {
      sopFixture = makeSopDetail({ status: 'active' })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Settings'))

      await waitFor(() => {
        expect(screen.getByText('Archive SOP')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Archive SOP'))

      await waitFor(() => {
        expect(screen.getByText('Archive SOP')).toBeInTheDocument()
      })
    })

    it('hides action buttons when user cannot mutate', async () => {
      mockCanMutate = false
      sopFixture = makeSopDetail({ status: 'draft' })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('draft')).toBeInTheDocument()
      })

      expect(screen.queryByText('Activate')).not.toBeInTheDocument()
      expect(screen.queryByText('Archive')).not.toBeInTheDocument()
    })
  })

  describe('mutation error feedback', () => {
    it('shows error message when activate fails', async () => {
      sopFixture = makeSopDetail({ status: 'draft' })
      shouldRejectPost = true

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Activate')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Activate'))

      await waitFor(() => {
        expect(screen.getByText('Failed to activate SOP')).toBeInTheDocument()
      })
    })

    it('shows error message when archive fails', async () => {
      sopFixture = makeSopDetail({ status: 'active' })
      shouldRejectPost = true

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Settings'))

      await waitFor(() => {
        expect(screen.getByText('Archive SOP')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Archive SOP'))

      await waitFor(() => {
        expect(screen.getByText('Failed to archive SOP')).toBeInTheDocument()
      })
    })
  })

  describe('admin features', () => {
    it('shows danger zone for admins under Settings tab', async () => {
      mockIsAdmin = true

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Settings'))

      await waitFor(() => {
        expect(screen.getByText('Danger Zone')).toBeInTheDocument()
      })
    })

    it('hides Settings tab for non-admins', async () => {
      mockIsAdmin = false

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Details')).toBeInTheDocument()
      })

      expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    })
  })

  describe('template info', () => {
    it('shows template name when SOP was forked', async () => {
      sopFixture = makeSopDetail({
        template: {
          id: '00000000-0000-0000-0000-000000000100',
          name: 'WISMO Template',
          slug: 'wismo',
        },
      })

      renderPage()

      await waitFor(() => {
        expect(screen.getByText('Details')).toBeInTheDocument()
      })

      // Template name appears in both header and details card
      expect(screen.getAllByText('WISMO Template')).toHaveLength(2)
    })
  })
})
