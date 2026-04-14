// modelguide-api/tests/unit/cli/run-evals.test.ts
import { describe, expect, test } from "bun:test";
import { computePassRate, formatResultsTable } from "@/cli/commands/run-evals";

const makeResult = (passed: boolean | null) => ({
  testCaseId: "tc-1",
  testCaseName: "test case",
  evalRunId: "er-1",
  sessionId: "s-1",
  passed,
  status: passed === null ? "error" : "completed",
  scores: [],
});

describe("computePassRate", () => {
  test("returns 100 when all pass", () => {
    expect(computePassRate([makeResult(true), makeResult(true)])).toBe(100);
  });

  test("returns 0 when all fail", () => {
    expect(computePassRate([makeResult(false), makeResult(false)])).toBe(0);
  });

  test("ignores errored cases (passed=null) in denominator", () => {
    // 2 pass, 1 fail, 1 error → 2/3 = 67
    const results = [makeResult(true), makeResult(true), makeResult(false), makeResult(null)];
    expect(computePassRate(results)).toBe(67);
  });

  test("returns 0 for empty results", () => {
    expect(computePassRate([])).toBe(0);
  });
});

describe("formatResultsTable", () => {
  test("includes PASS and FAIL labels", () => {
    const table = formatResultsTable([makeResult(true), makeResult(false)]);
    expect(table).toContain("PASS");
    expect(table).toContain("FAIL");
  });

  test("includes pass rate summary in correct format", () => {
    const table = formatResultsTable([makeResult(true), makeResult(true)]);
    expect(table).toContain("Pass rate: 2/2 (100%)");
  });

  test("includes ERROR label for null passed", () => {
    const table = formatResultsTable([makeResult(null)]);
    expect(table).toContain("ERROR");
  });

  test("includes failure reasoning detail for failed results with scores", () => {
    const resultWithScores = {
      testCaseId: "tc-2",
      testCaseName: "test with scores",
      evalRunId: "er-2",
      sessionId: "s-2",
      passed: false as false,
      status: "completed",
      scores: [{ name: "respects-guardrails", result: "fail", reasoning: "Agent violated the rule" }],
    };
    const table = formatResultsTable([resultWithScores]);
    expect(table).toContain("↳ respects-guardrails");
    expect(table).toContain("Agent violated the rule");
  });
});
