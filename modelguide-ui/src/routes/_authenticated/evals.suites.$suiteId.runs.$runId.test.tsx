import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeEvalRunScore,
  makeEvalSuiteDetail,
  makeEvalSuiteRun,
  makeTestCaseResult,
} from '../../../test/eval-suite-fixtures'
import type { EvalSuiteDetail, EvalSuiteRun } from '../../schemas/eval-suites'

// --- Mocks ---

const mockParams: Record<string, string> = {
  suiteId: '00000000-0000-0000-0000-d00000000001',
  runId: '00000000-0000-0000-0000-200000000001',
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mockParams,
  }),
  Link: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => (
    // biome-ignore lint/a11y/useValidAnchor: mock Link for tests
    <a className={className}>{children}</a>
  ),
}))

vi.mock('~/lib/utils', () => ({
  formatDate: (date: string) => date,
  formatDuration: (seconds: number) => `${Math.round(seconds)}s`,
}))

let runFixture: EvalSuiteRun = makeEvalSuiteRun()
let suiteFixture: EvalSuiteDetail = makeEvalSuiteDetail()
let shouldRejectGet = false

vi.mock('~/lib/api', () => ({
  api: {
    get: (url: string) => ({
      json: () => {
        if (shouldRejectGet) return Promise.reject(new Error('Not found'))
        if (url.includes('/runs/')) return Promise.resolve(runFixture)
        return Promise.resolve(suiteFixture)
      },
    }),
  },
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RunDetailPage />
    </QueryClientProvider>,
  )
}

const { Route } = await import('./evals.suites.$suiteId.runs.$runId')
// biome-ignore lint/suspicious/noExplicitAny: accessing internal Route.component for test rendering
const RunDetailPage = (Route as any).component as React.ComponentType

// --- Tests ---

describe('RunDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shouldRejectGet = false
    runFixture = makeEvalSuiteRun()
    suiteFixture = makeEvalSuiteDetail()
  })

  it('renders page header with "Run Results" title', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Run Results')).toBeInTheDocument()
    })
  })

  it('renders suite name as subtitle', async () => {
    suiteFixture = makeEvalSuiteDetail({ name: 'WISMO Eval Suite' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('WISMO Eval Suite')).toBeInTheDocument()
    })
  })

  it('shows result badge (Passed/Failed)', async () => {
    runFixture = makeEvalSuiteRun({ passed: true })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Passed')).toBeInTheDocument()
    })
  })

  it('shows Failed badge when run failed', async () => {
    runFixture = makeEvalSuiteRun({ passed: false })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })

  it('shows prompt source badge', async () => {
    runFixture = makeEvalSuiteRun({ promptSource: 'compiled' })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Compiled')).toBeInTheDocument()
    })
  })

  it('renders metadata card with Duration, Started, Completed', async () => {
    runFixture = makeEvalSuiteRun({
      durationMs: 1234,
      startedAt: '2026-03-20T10:00:00Z',
      completedAt: '2026-03-20T10:00:01Z',
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Duration')).toBeInTheDocument()
    })

    expect(screen.getByText('Started')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('renders session link when sessionId is present', async () => {
    runFixture = makeEvalSuiteRun({
      sessionId: '99999999-9999-9999-9999-999999999999',
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Session')).toBeInTheDocument()
    })

    expect(screen.getByText('99999999-9999-9999-9999-999999999999')).toBeInTheDocument()
  })

  it('renders test case results', async () => {
    runFixture = makeEvalSuiteRun({
      testCaseResults: [
        makeTestCaseResult({
          testCaseId: 'tc-1',
          testCaseName: 'Happy Path',
          passed: true,
          scores: [makeEvalRunScore({ id: 's-1', name: 'tool_called: get_order', result: 'pass' })],
        }),
      ],
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('1/1 test cases passed')).toBeInTheDocument()
    })

    expect(screen.getByText('Happy Path')).toBeInTheDocument()
  })

  it('shows error state when API fails', async () => {
    shouldRejectGet = true

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Failed to load run results')).toBeInTheDocument()
    })
  })

  it('shows em dash for missing duration', async () => {
    runFixture = makeEvalSuiteRun({ durationMs: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Duration')).toBeInTheDocument()
    })

    // The em dash character
    const durationEl = screen.getByText('Duration').closest('div')
    expect(durationEl?.textContent).toContain('\u2014')
  })
})
