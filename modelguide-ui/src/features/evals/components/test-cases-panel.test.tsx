import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { makeEvalSuiteTestCase } from '../../../../test/eval-suite-fixtures'
import { TestCasesPanel } from './test-cases-panel'

// Mock TanStack Router's Link component
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TestCasesPanel', () => {
  it('renders all test case names', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path' }),
      makeEvalSuiteTestCase({ id: 'tc-2', name: 'Edge Case' }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    expect(screen.getByText('Happy Path')).toBeInTheDocument()
    expect(screen.getByText('Edge Case')).toBeInTheDocument()
  })

  it('shows source badge for each test case', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', source: 'auto' }),
      makeEvalSuiteTestCase({ id: 'tc-2', source: 'manual' }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    expect(screen.getByText('auto')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
  })

  it('shows expected behavior when expanded', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        expectedBehavior: 'Agent looks up order and reports status',
      }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    fireEvent.click(screen.getByText('Happy Path'))

    expect(screen.getByText('Agent looks up order and reports status')).toBeInTheDocument()
  })

  it('shows input JSON when expanded', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        input: { userMessage: 'Where is my order?' },
      }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    fireEvent.click(screen.getByText('Happy Path'))

    expect(screen.getByText(/Where is my order/)).toBeInTheDocument()
  })

  it('collapses test case on second click', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        name: 'Happy Path',
        expectedBehavior: 'Agent looks up order',
      }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    // Expand
    fireEvent.click(screen.getByText('Happy Path'))
    expect(screen.getByText('Agent looks up order')).toBeInTheDocument()

    // Collapse
    fireEvent.click(screen.getByText('Happy Path'))
    expect(screen.queryByText('Agent looks up order')).not.toBeInTheDocument()
  })

  it('shows empty state when no test cases', () => {
    renderWithProviders(<TestCasesPanel testCases={[]} suiteId="suite-1" />)

    expect(screen.getByText('No test cases yet')).toBeInTheDocument()
  })

  it('filters test cases by source', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Auto Test', source: 'auto' }),
      makeEvalSuiteTestCase({ id: 'tc-2', name: 'Manual Test', source: 'manual' }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    // Click "Manual" filter
    fireEvent.click(screen.getByText('Manual'))

    expect(screen.queryByText('Auto Test')).not.toBeInTheDocument()
    expect(screen.getByText('Manual Test')).toBeInTheDocument()
  })

  it('filters test cases by search query', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Order Lookup Flow' }),
      makeEvalSuiteTestCase({ id: 'tc-2', name: 'Escalation Edge Case' }),
    ]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    const input = screen.getByPlaceholderText('Search test cases...')
    fireEvent.change(input, { target: { value: 'escalation' } })

    expect(screen.queryByText('Order Lookup Flow')).not.toBeInTheDocument()
    expect(screen.getByText('Escalation Edge Case')).toBeInTheDocument()
  })

  it('shows no results message when filters match nothing', () => {
    const testCases = [makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path' })]

    renderWithProviders(<TestCasesPanel testCases={testCases} suiteId="suite-1" />)

    const input = screen.getByPlaceholderText('Search test cases...')
    fireEvent.change(input, { target: { value: 'nonexistent' } })

    expect(screen.getByText('No test cases match your filters')).toBeInTheDocument()
  })
})
