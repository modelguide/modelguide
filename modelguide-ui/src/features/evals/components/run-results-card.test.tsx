import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  makeEvalRunScore,
  makeEvalSuiteTestCase,
  makeTestCaseResult,
} from '../../../../test/eval-suite-fixtures'
import { RunResultsCard } from './run-results-card'

describe('RunResultsCard', () => {
  it('renders summary bar with pass count', () => {
    const results = [
      makeTestCaseResult({ testCaseId: 'tc-1', passed: true }),
      makeTestCaseResult({ testCaseId: 'tc-2', passed: false }),
      makeTestCaseResult({ testCaseId: 'tc-3', passed: true }),
    ]

    render(<RunResultsCard testCaseResults={results} />)

    expect(screen.getByText('2/3 test cases passed')).toBeInTheDocument()
  })

  it('renders all test case results with pass/fail icon', () => {
    const testCases = [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path' }),
      makeEvalSuiteTestCase({ id: 'tc-2', name: 'Edge Case' }),
    ]
    const results = [
      makeTestCaseResult({ testCaseId: 'tc-1', passed: true }),
      makeTestCaseResult({ testCaseId: 'tc-2', passed: false }),
    ]

    render(<RunResultsCard testCaseResults={results} testCases={testCases} />)

    expect(screen.getByText('Happy Path')).toBeInTheDocument()
    expect(screen.getByText('Edge Case')).toBeInTheDocument()
  })

  it('shows evaluator pass count per result', () => {
    const results = [
      makeTestCaseResult({
        testCaseId: 'tc-1',
        scores: [
          makeEvalRunScore({ id: 's-1', evalConfigId: 'c-1', result: 'pass' }),
          makeEvalRunScore({ id: 's-2', evalConfigId: 'c-2', result: 'fail' }),
          makeEvalRunScore({ id: 's-3', evalConfigId: 'c-3', result: 'pass' }),
        ],
      }),
    ]

    render(<RunResultsCard testCaseResults={results} />)

    expect(screen.getByText('2/3 evaluators passed')).toBeInTheDocument()
  })

  it('expands result on click and shows score breakdown', () => {
    const results = [
      makeTestCaseResult({
        testCaseId: 'tc-1',
        scores: [
          makeEvalRunScore({
            id: 's-1',
            evalConfigId: 'c-1',
            name: 'tool_called: get_order',
            result: 'pass',
          }),
        ],
      }),
    ]
    const testCases = [makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path' })]

    render(<RunResultsCard testCaseResults={results} testCases={testCases} />)

    // Score details should not be visible yet
    expect(screen.queryByText('Score Breakdown:')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByText('Happy Path'))

    expect(screen.getByText('Score Breakdown:')).toBeInTheDocument()
    expect(screen.getByText('tool_called: get_order')).toBeInTheDocument()
    expect(screen.getByText('tool_called')).toBeInTheDocument()
  })

  it('shows score name and evaluator type badge for each score', () => {
    const results = [
      makeTestCaseResult({
        testCaseId: 'tc-1',
        scores: [
          makeEvalRunScore({
            id: 's-1',
            evalConfigId: 'c-1',
            name: 'tool_called: get_order',
            result: 'pass',
            evaluatorType: 'tool_called',
          }),
          makeEvalRunScore({
            id: 's-2',
            evalConfigId: 'c-2',
            name: 'llm_judge: Confirms status',
            result: 'fail',
            evaluatorType: 'llm_judge',
          }),
        ],
      }),
    ]

    render(<RunResultsCard testCaseResults={results} />)

    // Expand
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('tool_called: get_order')).toBeInTheDocument()
    expect(screen.getByText('llm_judge: Confirms status')).toBeInTheDocument()
    // Evaluator type badges render instead of result badges
    expect(screen.getByText('tool_called')).toBeInTheDocument()
    expect(screen.getByText('llm_judge')).toBeInTheDocument()
  })

  it('shows reasoning text for failed scores', () => {
    const results = [
      makeTestCaseResult({
        testCaseId: 'tc-1',
        scores: [
          makeEvalRunScore({
            id: 's-1',
            evalConfigId: 'c-1',
            name: 'tool_called: update_order',
            result: 'fail',
            reasoning: 'Tool was not called during the session',
          }),
        ],
      }),
    ]

    render(<RunResultsCard testCaseResults={results} />)

    // Expand
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Tool was not called during the session')).toBeInTheDocument()
  })

  it('shows percentage badge in summary', () => {
    const results = [
      makeTestCaseResult({ testCaseId: 'tc-1', passed: true }),
      makeTestCaseResult({ testCaseId: 'tc-2', passed: true }),
    ]

    render(<RunResultsCard testCaseResults={results} />)

    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('resolves test case names from provided testCases', () => {
    const testCases = [makeEvalSuiteTestCase({ id: 'tc-1', name: 'Order Lookup Test' })]
    const results = [makeTestCaseResult({ testCaseId: 'tc-1' })]

    render(<RunResultsCard testCaseResults={results} testCases={testCases} />)

    expect(screen.getByText('Order Lookup Test')).toBeInTheDocument()
  })

  it('shows truncated ID fallback when test case not found', () => {
    const results = [makeTestCaseResult({ testCaseId: 'abcdef01-2222-3333-4444-555555555555' })]

    render(<RunResultsCard testCaseResults={results} testCases={[]} />)

    expect(screen.getByText('Test Case abcdef01…')).toBeInTheDocument()
  })
})
