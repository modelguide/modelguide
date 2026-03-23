import type {
  EvalRunScore,
  EvalSuiteAssertion,
  EvalSuiteDetail,
  EvalSuiteRun,
  EvalSuiteSummary,
  EvalSuiteTestCase,
  TestCaseResult,
} from '~/schemas/eval-suites'

export function makeEvalSuiteAssertion(
  overrides: Partial<EvalSuiteAssertion> = {},
): EvalSuiteAssertion {
  return {
    id: '00000000-0000-0000-0000-a00000000001',
    testCaseId: '00000000-0000-0000-0000-b00000000001',
    evalConfigId: '00000000-0000-0000-0000-c00000000001',
    name: 'tool_called: get_order',
    sopStepId: 'step-1',
    source: 'auto',
    order: 1,
    required: true,
    createdAt: '2026-02-15T10:00:00Z',
    ...overrides,
  }
}

export function makeEvalSuiteTestCase(
  overrides: Partial<EvalSuiteTestCase> = {},
): EvalSuiteTestCase {
  return {
    id: '00000000-0000-0000-0000-b00000000001',
    suiteId: '00000000-0000-0000-0000-d00000000001',
    name: 'Happy Path',
    description: 'Tests normal order flow',
    source: 'auto',
    input: { userMessage: 'Where is my order?' },
    expectedBehavior: 'Agent looks up order and reports status',
    order: 1,
    evaluators: [makeEvalSuiteAssertion()],
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-02-16T12:00:00Z',
    ...overrides,
  }
}

export function makeEvalSuiteSummary(overrides: Partial<EvalSuiteSummary> = {}): EvalSuiteSummary {
  return {
    id: '00000000-0000-0000-0000-d00000000001',
    agentId: '00000000-0000-0000-0000-e00000000001',
    agentName: 'GlowBox Agent',
    sopId: '00000000-0000-0000-0000-f00000000001',
    sopName: 'Order Lookup',
    name: 'WISMO Eval Suite',
    description: 'Evaluates order lookup flow',
    createdBy: '00000000-0000-0000-0000-100000000001',
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-02-16T12:00:00Z',
    ...overrides,
  }
}

export function makeEvalSuiteDetail(overrides: Partial<EvalSuiteDetail> = {}): EvalSuiteDetail {
  return {
    ...makeEvalSuiteSummary(),
    testCases: [
      makeEvalSuiteTestCase({ id: 'tc-1', name: 'Happy Path', order: 1 }),
      makeEvalSuiteTestCase({
        id: 'tc-2',
        name: 'Edge Case',
        order: 2,
        source: 'manual',
        description: 'Tests edge case scenario',
        evaluators: [
          makeEvalSuiteAssertion({
            id: 'a-2a',
            testCaseId: 'tc-2',
            name: 'llm_judge: Confirms status',
            order: 1,
          }),
          makeEvalSuiteAssertion({
            id: 'a-2b',
            testCaseId: 'tc-2',
            name: 'tool_called: search_products',
            order: 2,
            required: false,
          }),
        ],
      }),
      makeEvalSuiteTestCase({
        id: 'tc-3',
        name: 'Guardrail Test',
        order: 3,
        description: 'Tests guardrail behavior',
      }),
    ],
    ...overrides,
  }
}

export function makeEvalRunScore(overrides: Partial<EvalRunScore> = {}): EvalRunScore {
  return {
    id: '00000000-0000-0000-0000-s00000000001',
    evalConfigId: '00000000-0000-0000-0000-c00000000001',
    name: 'tool_called: get_order',
    scoreOrder: 1,
    required: true,
    evaluatorType: 'tool_called',
    result: 'pass',
    reasoning: null,
    failureClassification: null,
    expected: null,
    actual: null,
    durationMs: 50,
    createdAt: '2026-02-17T10:00:00Z',
    ...overrides,
  }
}

export function makeTestCaseResult(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    testCaseId: '00000000-0000-0000-0000-b00000000001',
    evalRunId: '00000000-0000-0000-0000-200000000001',
    passed: true,
    status: 'completed',
    scores: [makeEvalRunScore()],
    ...overrides,
  }
}

export function makeEvalSuiteRun(overrides: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id: '00000000-0000-0000-0000-200000000001',
    suiteId: '00000000-0000-0000-0000-d00000000001',
    promptSource: 'compiled',
    passed: true,
    triggeredBy: '00000000-0000-0000-0000-100000000001',
    startedAt: '2026-02-17T10:00:00Z',
    completedAt: '2026-02-17T10:00:01Z',
    durationMs: 1234,
    metadata: null,
    testCaseResults: [makeTestCaseResult()],
    ...overrides,
  }
}
