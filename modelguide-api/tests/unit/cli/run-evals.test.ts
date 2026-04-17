// modelguide-api/tests/unit/cli/run-evals.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildMissingAdminUserMessage,
  computePassRate,
  formatResultsTable,
} from "../../../src/cli/commands/run-evals.helpers";
import { selectRunEvalsSuites } from "../../../src/cli/commands/run-evals.selection";

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
    const results = [
      makeResult(true),
      makeResult(true),
      makeResult(false),
      makeResult(null),
    ];
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

  test("handles empty results list", () => {
    expect(formatResultsTable([])).toContain("Pass rate: 0/0 (0%)");
  });

  test("includes failure reasoning detail for failed results with scores", () => {
    const resultWithScores = {
      testCaseId: "tc-2",
      testCaseName: "test with scores",
      evalRunId: "er-2",
      sessionId: "s-2",
      passed: false as false,
      status: "completed",
      scores: [
        {
          name: "respects-guardrails",
          result: "fail",
          reasoning: "Agent violated the rule",
        },
      ],
    };
    const table = formatResultsTable([resultWithScores]);
    expect(table).toContain("↳ respects-guardrails");
    expect(table).toContain("Agent violated the rule");
  });
});

describe("buildMissingAdminUserMessage", () => {
  test("includes a runnable add-users example with the org slug", () => {
    const message = buildMissingAdminUserMessage("glowskin");
    expect(message).toContain('No admin user found for org "glowskin".');
    expect(message).toContain("mg add-users --org glowskin");
    expect(message).toContain("role=admin");
  });
});

describe("selectRunEvalsSuites", () => {
  const agents = [
    { id: "agent-a", slug: "alpha" },
    { id: "agent-b", slug: "beta" },
  ];
  const sops = [
    { id: "sop-1", slug: "order_status", name: "Order Status" },
    { id: "sop-2", slug: "returns", name: "Returns" },
  ];
  const suites = [
    { id: "suite-1", name: "Order Status", agentId: "agent-a", sopId: "sop-1" },
    { id: "suite-2", name: "Returns", agentId: "agent-a", sopId: "sop-2" },
    { id: "suite-3", name: "Order Status", agentId: "agent-b", sopId: "sop-1" },
  ];

  test("filters by agent slug and suite slug together", () => {
    expect(
      selectRunEvalsSuites({
        suites,
        agents,
        sops,
        agentSlug: "alpha",
        suiteSlugs: ["order_status"],
      }),
    ).toEqual([suites[0]]);
  });

  test("throws when a requested suite slug does not exist", () => {
    expect(() =>
      selectRunEvalsSuites({
        suites,
        agents,
        sops,
        suiteSlugs: ["missing_suite"],
      }),
    ).toThrow("SOP slug(s) not found in org: missing_suite");
  });

  test("throws when the suite exists but not for the selected agent", () => {
    expect(() =>
      selectRunEvalsSuites({
        suites: [suites[2]],
        agents,
        sops,
        agentSlug: "alpha",
        suiteSlugs: ["order_status"],
      }),
    ).toThrow(
      'No eval suite found for agent "alpha" for SOP slug(s): order_status',
    );
  });
});
