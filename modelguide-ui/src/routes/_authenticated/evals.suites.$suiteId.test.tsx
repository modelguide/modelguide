import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeEvalSuiteDetail,
  makeEvalSuiteRun,
  makeTestCaseResult,
} from '../../../test/eval-suite-fixtures'
import type { EvalSuiteDetail, EvalSuiteRun } from '../../schemas/eval-suites'

// --- Mocks ---

const mockNavigate = vi.fn()
const mockParams: Record<string, string> = { suiteId: '00000000-0000-0000-0000-d00000000001' }

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mockParams,
  }),
  useNavigate: () => mockNavigate,
  useMatch: () => null,
  Outlet: () => null,
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
  formatDuration: (seconds: number) => `${Math.round(seconds)}s`,
}))

let suiteFixture: EvalSuiteDetail = makeEvalSuiteDetail()
let runsFixture: EvalSuiteRun[] = []
let shouldRejectGet = false

vi.mock('~/lib/api', () => ({
  api: {
    get: (url: string) => ({
      json: () => {
        if (shouldRejectGet) return Promise.reject(new Error('Not found'))
        if (url.includes('/runs')) {
          return Promise.resolve({
            data: runsFixture,
            pagination: {
              page: 1,
              pageSize: 20,
              totalItems: runsFixture.length,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          })
        }
        return Promise.resolve(suiteFixture)
      },
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
      <SuiteDetailPage />
    </QueryClientProvider>,
  )
}

const { Route } = await import('./evals.suites.$suiteId')
// biome-ignore lint/suspicious/noExplicitAny: accessing internal Route.component for test rendering
const SuiteDetailPage = (Route as any).component as React.ComponentType

// --- Tests ---

describe('SuiteDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin = true
    suiteFixture = makeEvalSuiteDetail()
    runsFixture = []
    shouldRejectGet = false
  })

  it('renders suite name and description after loading', async () => {
    suiteFixture = makeEvalSuiteDetail({
      name: 'WISMO Eval Suite',
      description: 'Evaluates order lookup flow',
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('WISMO Eval Suite')).toBeInTheDocument()
    })

    expect(screen.getByText('Evaluates order lookup flow')).toBeInTheDocument()
  })

  it('renders Test Cases and Runs tabs', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Test Cases')).toBeInTheDocument()
    })

    expect(screen.getByText('Runs')).toBeInTheDocument()
  })

  it('shows test cases in default tab', async () => {
    suiteFixture = makeEvalSuiteDetail()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Happy Path')).toBeInTheDocument()
    })

    expect(screen.getByText('Edge Case')).toBeInTheDocument()
    expect(screen.getByText('Guardrail Test')).toBeInTheDocument()
  })

  it('switches to Runs tab and shows run history', async () => {
    runsFixture = [
      makeEvalSuiteRun({ id: 'run-1', passed: true }),
      makeEvalSuiteRun({
        id: 'run-2',
        passed: false,
        testCaseResults: [makeTestCaseResult({ testCaseId: 'tc-1', passed: false })],
      }),
    ]

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Test Cases')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Runs'))

    await waitFor(() => {
      expect(screen.getByText('Completed · 100%')).toBeInTheDocument()
    })

    expect(screen.getByText('Completed · 0%')).toBeInTheDocument()
  })

  it('shows "Evaluate Session" and "Simulate & Run" buttons for admin', async () => {
    mockIsAdmin = true

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Evaluate Session')).toBeInTheDocument()
    })

    expect(screen.getByText('Simulate & Run')).toBeInTheDocument()
  })

  it('hides action buttons and "Delete" for non-admin', async () => {
    mockIsAdmin = false

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Test Cases')).toBeInTheDocument()
    })

    expect(screen.queryByText('Evaluate Session')).not.toBeInTheDocument()
    expect(screen.queryByText('Simulate & Run')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('shows error state when API fails', async () => {
    shouldRejectGet = true

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Failed to load eval suite')).toBeInTheDocument()
    })
  })

  it('shows loading spinner while fetching', () => {
    // Don't resolve the promise to keep it loading
    renderPage()

    expect(screen.getByText('Suite Detail')).toBeInTheDocument()
  })
})
