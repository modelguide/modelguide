import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeEvalSuiteRun, makeTestCaseResult } from '../../../../test/eval-suite-fixtures'
import { SuiteRunsTable } from './suite-runs-table'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('~/lib/utils', () => ({
  formatDate: (date: string) => date,
  formatDuration: (seconds: number) => `${Math.round(seconds)}s`,
}))

describe('SuiteRunsTable', () => {
  const suiteId = '00000000-0000-0000-0000-d00000000001'

  it('renders table headers', () => {
    render(<SuiteRunsTable runs={[]} suiteId={suiteId} />)

    // Empty state is shown instead of headers when runs=[]
    expect(screen.getByText('No runs yet')).toBeInTheDocument()
  })

  it('renders passed run with success badge', () => {
    const runs = [makeEvalSuiteRun({ passed: true })]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    expect(screen.getByText('Passed')).toBeInTheDocument()
  })

  it('renders failed run with error badge', () => {
    const runs = [makeEvalSuiteRun({ passed: false })]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders inconclusive run (passed=null) with warning badge', () => {
    const runs = [makeEvalSuiteRun({ passed: null })]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    expect(screen.getByText('Inconclusive')).toBeInTheDocument()
  })

  it('shows prompt source badge', () => {
    const runs = [makeEvalSuiteRun({ promptSource: 'compiled' })]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    expect(screen.getByText('Compiled')).toBeInTheDocument()
  })

  it('shows pass count', () => {
    const runs = [
      makeEvalSuiteRun({
        testCaseResults: [
          makeTestCaseResult({ testCaseId: 'tc-1', passed: true }),
          makeTestCaseResult({ testCaseId: 'tc-2', passed: false }),
          makeTestCaseResult({ testCaseId: 'tc-3', passed: true }),
        ],
      }),
    ]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    expect(screen.getByText('2/3 passed')).toBeInTheDocument()
  })

  it('shows formatted duration', () => {
    const runs = [makeEvalSuiteRun({ durationMs: 2500 })]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    // 2500ms / 1000 = 2.5 → Math.round → "3s" from mock
    expect(screen.getByText('3s')).toBeInTheDocument()
  })

  it('shows empty state when runs=[]', () => {
    render(<SuiteRunsTable runs={[]} suiteId={suiteId} />)

    expect(screen.getByText('No runs yet')).toBeInTheDocument()
    expect(screen.getByText('Run this suite against a session to see results')).toBeInTheDocument()
  })

  it('shows loading skeleton when isLoading=true', () => {
    const { container } = render(<SuiteRunsTable runs={[]} suiteId={suiteId} isLoading />)

    const skeletonElements = container.querySelectorAll('.animate-pulse')
    expect(skeletonElements.length).toBeGreaterThan(0)
  })

  it('renders table headers when runs exist', () => {
    const runs = [makeEvalSuiteRun()]

    render(<SuiteRunsTable runs={runs} suiteId={suiteId} />)

    expect(screen.getByText('Result')).toBeInTheDocument()
    expect(screen.getByText('Prompt Source')).toBeInTheDocument()
    expect(screen.getByText('Test Cases')).toBeInTheDocument()
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('Started')).toBeInTheDocument()
  })
})
