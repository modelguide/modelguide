import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeEvalSuiteAssertion, makeEvalSuiteTestCase } from '../../../../test/eval-suite-fixtures'
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

  it('shows evaluator count per test case', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        evaluators: [
          makeEvalSuiteAssertion({ id: 'a-1' }),
          makeEvalSuiteAssertion({ id: 'a-2' }),
          makeEvalSuiteAssertion({ id: 'a-3' }),
        ],
      }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

    expect(screen.getByText('3 evaluators')).toBeInTheDocument()
  })

  it('shows singular "evaluator" for single evaluator', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        evaluators: [makeEvalSuiteAssertion({ id: 'a-1' })],
      }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

    expect(screen.getByText('1 evaluator')).toBeInTheDocument()
  })

  it('expands test case on click and shows evaluators', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        name: 'Happy Path',
        evaluators: [makeEvalSuiteAssertion({ id: 'a-1', name: 'tool_called: get_order' })],
      }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

    // Evaluator details should not be visible yet
    expect(screen.queryByText('tool_called: get_order')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByText('Happy Path'))

    // Now evaluators should be visible
    expect(screen.getByText('tool_called: get_order')).toBeInTheDocument()
  })

  it('shows required/optional badges on evaluators', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        evaluators: [
          makeEvalSuiteAssertion({ id: 'a-1', required: true }),
          makeEvalSuiteAssertion({ id: 'a-2', required: false }),
        ],
      }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

    // Expand
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('required')).toBeInTheDocument()
    expect(screen.getByText('optional')).toBeInTheDocument()
  })

  it('shows expected behavior when expanded', () => {
    const testCases = [
      makeEvalSuiteTestCase({
        id: 'tc-1',
        expectedBehavior: 'Agent looks up order and reports status',
      }),
    ]

    render(<TestCasesPanel testCases={testCases} />)

    fireEvent.click(screen.getByRole('button'))

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

    fireEvent.click(screen.getByRole('button'))

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
})
