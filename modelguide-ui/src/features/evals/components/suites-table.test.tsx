import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeEvalSuiteSummary } from '../../../../test/eval-suite-fixtures'
import { SuitesTable } from './suites-table'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('~/lib/utils', () => ({
  formatDate: (date: string) => date,
}))

describe('SuitesTable', () => {
  it('renders table headers', () => {
    const suites = [makeEvalSuiteSummary()]

    render(<SuitesTable suites={suites} />)

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('SOP')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
  })

  it('renders suite rows with name', () => {
    const suites = [makeEvalSuiteSummary({ name: 'WISMO Eval Suite' })]

    render(<SuitesTable suites={suites} />)

    expect(screen.getByText('WISMO Eval Suite')).toBeInTheDocument()
  })

  it('shows description when present', () => {
    const suites = [makeEvalSuiteSummary({ description: 'Evaluates order lookup flow' })]

    render(<SuitesTable suites={suites} />)

    expect(screen.getByText('Evaluates order lookup flow')).toBeInTheDocument()
  })

  it('shows "Manual" when sopId is null', () => {
    const suites = [makeEvalSuiteSummary({ sopId: null })]

    render(<SuitesTable suites={suites} />)

    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('renders multiple rows', () => {
    const suites = [
      makeEvalSuiteSummary({ id: 'a', name: 'Suite Alpha' }),
      makeEvalSuiteSummary({ id: 'b', name: 'Suite Beta' }),
      makeEvalSuiteSummary({ id: 'c', name: 'Suite Gamma' }),
    ]

    render(<SuitesTable suites={suites} />)

    expect(screen.getByText('Suite Alpha')).toBeInTheDocument()
    expect(screen.getByText('Suite Beta')).toBeInTheDocument()
    expect(screen.getByText('Suite Gamma')).toBeInTheDocument()
  })

  it('shows loading skeleton when isLoading=true', () => {
    const { container } = render(<SuitesTable suites={[]} isLoading />)

    const skeletonElements = container.querySelectorAll('.animate-pulse')
    expect(skeletonElements.length).toBeGreaterThan(0)
  })

  it('shows empty state when suites=[]', () => {
    render(<SuitesTable suites={[]} />)

    expect(screen.getByText('No eval suites yet')).toBeInTheDocument()
    expect(screen.getByText('Init your first suite from an agent + SOP pair')).toBeInTheDocument()
  })
})
