import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEvalSuiteSummary } from '../../../test/eval-suite-fixtures'
import type { EvalSuiteSummary } from '../../schemas/eval-suites'

// --- Mocks ---

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  useNavigate: () => vi.fn(),
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

let mockIsAdmin = true
vi.mock('~/lib/permissions', () => ({
  useIsAdmin: () => mockIsAdmin,
}))

vi.mock('~/lib/utils', () => ({
  formatDate: (date: string) => date,
}))

let suitesFixture: EvalSuiteSummary[] = []
let shouldRejectGet = false

vi.mock('~/lib/api', () => ({
  api: {
    get: () => ({
      json: () =>
        shouldRejectGet
          ? Promise.reject(new Error('Failed'))
          : Promise.resolve({
              data: suitesFixture,
              pagination: {
                page: 1,
                pageSize: 20,
                totalItems: suitesFixture.length,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            }),
    }),
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
      <EvalsPage />
    </QueryClientProvider>,
  )
}

const { Route } = await import('./evals.index')
// biome-ignore lint/suspicious/noExplicitAny: accessing internal Route.component for test rendering
const EvalsPage = (Route as any).component as React.ComponentType

// --- Tests ---

describe('EvalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin = true
    suitesFixture = []
    shouldRejectGet = false
  })

  it('renders page header with "Eval Suites" title', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Eval Suites')).toBeInTheDocument()
    })

    expect(screen.getByText('Evaluate agent performance against SOPs')).toBeInTheDocument()
  })

  it('shows suites table with data when API returns suites', async () => {
    suitesFixture = [
      makeEvalSuiteSummary({ id: 'a', name: 'WISMO Suite' }),
      makeEvalSuiteSummary({ id: 'b', name: 'Returns Suite' }),
    ]

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('WISMO Suite')).toBeInTheDocument()
    })

    expect(screen.getByText('Returns Suite')).toBeInTheDocument()
  })

  it('shows empty state when no suites', async () => {
    suitesFixture = []

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No eval suites yet')).toBeInTheDocument()
    })
  })

  it('shows "Create Eval Suite" button for admin users', async () => {
    mockIsAdmin = true

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Create Eval Suite')).toBeInTheDocument()
    })
  })

  it('hides "Create Eval Suite" button for non-admin users', async () => {
    mockIsAdmin = false

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Eval Suites')).toBeInTheDocument()
    })

    expect(screen.queryByText('Create Eval Suite')).not.toBeInTheDocument()
  })
})
