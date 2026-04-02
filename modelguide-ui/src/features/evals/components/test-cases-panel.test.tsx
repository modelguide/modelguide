import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeEvalSuiteTestCase } from '../../../../test/eval-suite-fixtures'
import { TestCasesPanel } from './test-cases-panel'

describe('TestCasesPanel', () => {
  it('renders all test case names', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path' }),
      makeEvalSuiteTestCase({ id: 'tc-2', name: 'Edge Case' }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

    expect(screen.getByText('Happy Path')).toBeInTheDocument()
    expect(screen.getByText('Edge Case')).toBeInTheDocument()
  })

  it('shows source badge for each test case', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', source: 'auto' }),
      makeEvalSuiteTestCase({ id: 'tc-2', source: 'manual' }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

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

    render(<TestCasesPanel testCases={testCases} />)

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

    render(<TestCasesPanel testCases={testCases} />)

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

    render(<TestCasesPanel testCases={testCases} />)

    // Expand
    fireEvent.click(screen.getByText('Happy Path'))
    expect(screen.getByText('Agent looks up order')).toBeInTheDocument()

    // Collapse
    fireEvent.click(screen.getByText('Happy Path'))
    expect(screen.queryByText('Agent looks up order')).not.toBeInTheDocument()
  })

  it('shows empty state when no test cases', () => {
    render(<TestCasesPanel testCases={[]} />)

    expect(screen.getByText('No test cases yet')).toBeInTheDocument()
  })

  it('filters test cases by source', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Auto Test', source: 'auto' }),
      makeEvalSuiteTestCase({ id: 'tc-2', name: 'Manual Test', source: 'manual' }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

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

    render(<TestCasesPanel testCases={testCases} />)

    const input = screen.getByPlaceholderText('Search test cases...')
    fireEvent.change(input, { target: { value: 'escalation' } })

    expect(screen.queryByText('Order Lookup Flow')).not.toBeInTheDocument()
    expect(screen.getByText('Escalation Edge Case')).toBeInTheDocument()
  })

  it('shows no results message when filters match nothing', () => {
    const testCases = [makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path' })]

    render(<TestCasesPanel testCases={testCases} />)

    const input = screen.getByPlaceholderText('Search test cases...')
    fireEvent.change(input, { target: { value: 'nonexistent' } })

    expect(screen.getByText('No test cases match your filters')).toBeInTheDocument()
  })
})
