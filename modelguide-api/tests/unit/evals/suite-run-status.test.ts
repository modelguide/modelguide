/**
 * Unit tests for determineSuiteRunStatus (AC 22-24).
 *
 * Tests the pure status determination logic extracted from
 * the simulate-and-run task handler.
 */

import { describe, expect, test } from "bun:test";
import { determineSuiteRunStatus } from "@features/evals/eval-suites-simulate.service";

function makeResult(passed: boolean | null) {
  return {
    testCaseId: "tc-1",
    testCaseName: "test",
    evalRunId: passed !== null ? "run-1" : null,
    passed,
    scores: [],
  };
}

describe("determineSuiteRunStatus", () => {
  test("returns 'completed' when all test cases succeeded", () => {
    const results = [makeResult(true), makeResult(true), makeResult(false)];
    expect(determineSuiteRunStatus(results)).toBe("completed");
  });

  test("returns 'failed' when all test cases errored", () => {
    const results = [makeResult(null), makeResult(null)];
    expect(determineSuiteRunStatus(results)).toBe("failed");
  });

  test("returns 'completed_with_errors' when some errored", () => {
    const results = [makeResult(true), makeResult(null), makeResult(false)];
    expect(determineSuiteRunStatus(results)).toBe("completed_with_errors");
  });

  test("returns 'completed' for single passing test case", () => {
    const results = [makeResult(true)];
    expect(determineSuiteRunStatus(results)).toBe("completed");
  });

  test("returns 'failed' for single errored test case", () => {
    const results = [makeResult(null)];
    expect(determineSuiteRunStatus(results)).toBe("failed");
  });
});
