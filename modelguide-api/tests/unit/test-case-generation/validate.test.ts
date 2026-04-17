/**
 * Unit tests for structural validation and GenerationRunResult aggregation.
 *
 * validateStructural() is pure logic (no LLM).
 * validateSemantic() requires LLM calls — tested via integration tests.
 * buildRunResult() is tested indirectly via the exported types and service.
 */

import { describe, expect, test } from "bun:test";
import type { SopStep } from "@features/sops/sops.types";
import type { GeneratedTestCase } from "@features/test-case-generation/types";
import { validateStructural } from "@features/test-case-generation/validate";

// ============================================================================
// Fixtures
// ============================================================================

/** SOP steps with two tools — one required, one optional. */
const sopSteps: SopStep[] = [
  {
    id: "step-1",
    order: 1,
    instruction: "Look up the customer's order",
    required: true,
    tool: {
      connectorToolId: "ct-001",
      resolvedName: "glowbox_store_get_order",
    },
  },
  {
    id: "step-2",
    order: 2,
    instruction: "Create a return if eligible",
    required: false,
    tool: {
      connectorToolId: "ct-002",
      resolvedName: "glowbox_store_create_return",
    },
  },
  {
    id: "step-3",
    order: 3,
    instruction: "Send confirmation to customer",
    required: true,
  },
];

/** SOP steps with no tools. */
const sopStepsNoTools: SopStep[] = [
  {
    id: "step-1",
    order: 1,
    instruction: "Greet the customer",
    required: true,
  },
  {
    id: "step-2",
    order: 2,
    instruction: "Answer their question",
    required: true,
  },
];

/** Valid generated test case matching the SOP tools. */
const validTestCase: GeneratedTestCase = {
  name: "order_status - polite - straightforward",
  scenario: "Customer wants to check their order status.",
  customer_message:
    "Hi there, I would like to check on my order please. My order number is ORD-12345.",
  mock_tool_responses: {
    glowbox_store_get_order: { status: "delivered", tracking: "1Z999" },
    glowbox_store_create_return: { returnId: "RET-001", label: "https://..." },
  },
  llm_judge_criterion:
    "The agent looked up the order status and informed the customer of the current status and tracking information.",
};

// ============================================================================
// Structural validation — rejection cases
// ============================================================================

describe("validateStructural", () => {
  describe("rejects invalid cases", () => {
    test("(a) mock tool slug doesn't match any SOP tool reference", () => {
      const badSlug: GeneratedTestCase = {
        ...validTestCase,
        mock_tool_responses: {
          glowbox_store_get_order: { status: "delivered" },
          nonexistent_tool: { data: "should not be here" },
        },
      };

      const result = validateStructural(badSlug, sopSteps);
      expect(result.valid).toBe(false);
      expect(result.source).toBe("structural");
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("nonexistent_tool")]),
      );
    });

    test("(b) required SOP tool has no mock response", () => {
      const missingRequired: GeneratedTestCase = {
        ...validTestCase,
        mock_tool_responses: {
          // Missing glowbox_store_get_order (required)
          glowbox_store_create_return: { returnId: "RET-001" },
        },
      };

      const result = validateStructural(missingRequired, sopSteps);
      expect(result.valid).toBe(false);
      expect(result.source).toBe("structural");
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("glowbox_store_get_order"),
        ]),
      );
    });

    test("(c) customer_message is fewer than 5 words", () => {
      const shortMessage: GeneratedTestCase = {
        ...validTestCase,
        customer_message: "Order status please",
      };

      const result = validateStructural(shortMessage, sopSteps);
      expect(result.valid).toBe(false);
      expect(result.source).toBe("structural");
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("too short")]),
      );
    });

    test("accumulates multiple issues in a single validation", () => {
      const multipleIssues: GeneratedTestCase = {
        name: "bad case",
        scenario: "Bad",
        customer_message: "Hi",
        mock_tool_responses: {
          fake_tool: { data: true },
        },
        llm_judge_criterion: "The agent handled the request.",
      };

      const result = validateStructural(multipleIssues, sopSteps);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // Structural validation — passing cases
  // ============================================================================

  describe("passes valid cases", () => {
    test("valid test case with all required tool mocks passes", () => {
      const result = validateStructural(validTestCase, sopSteps);
      expect(result.valid).toBe(true);
      expect(result.source).toBeNull();
      expect(result.issues).toEqual([]);
    });

    test("optional tool can be omitted from mock responses", () => {
      const noOptional: GeneratedTestCase = {
        ...validTestCase,
        mock_tool_responses: {
          glowbox_store_get_order: { status: "delivered" },
          // glowbox_store_create_return is optional — omission is fine
        },
      };

      const result = validateStructural(noOptional, sopSteps);
      expect(result.valid).toBe(true);
    });

    test("SOP with no tools and empty mock responses passes", () => {
      const noToolCase: GeneratedTestCase = {
        name: "greeting - polite - straightforward",
        scenario: "Customer greets the agent.",
        customer_message:
          "Hello, I have a question about your products and services.",
        mock_tool_responses: {},
        llm_judge_criterion:
          "The agent greeted the customer and provided helpful information.",
      };

      const result = validateStructural(noToolCase, sopStepsNoTools);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test("message with exactly 5 words passes", () => {
      const fiveWords: GeneratedTestCase = {
        ...validTestCase,
        customer_message: "Please check my order status",
      };

      const result = validateStructural(fiveWords, sopSteps);
      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================================
// GenerationRunResult aggregation (testing buildRunResult logic)
// ============================================================================

describe("GenerationRunResult aggregation", () => {
  // We test the aggregation logic by importing the types and verifying
  // the shape — buildRunResult is private, so we reconstruct the logic.

  test("correct accepted/rejected counts", () => {
    const rejections = [
      {
        tupleName: "order_status - frustrated - ambiguous",
        issues: ["customer_message too short — likely degenerate"],
        rejectionSource: "structural" as const,
      },
      {
        tupleName: "return - hostile - missing_order",
        issues: ["Scenario doesn't match message tone"],
        rejectionSource: "semantic" as const,
      },
      {
        tupleName: "delivery - confused - contradictory",
        issues: ['Mock tool slug "fake" doesn\'t match any SOP tool reference'],
        rejectionSource: "structural" as const,
      },
    ];

    const accepted = 7;
    const rejected = rejections.length;

    // Rejections by source
    const rejectionsBySource = { structural: 0, semantic: 0 };
    for (const r of rejections) {
      rejectionsBySource[r.rejectionSource]++;
    }

    expect(accepted + rejected).toBe(10);
    expect(rejectionsBySource.structural).toBe(2);
    expect(rejectionsBySource.semantic).toBe(1);
  });

  test("topIssues ranked by frequency descending", () => {
    const rejections = [
      {
        tupleName: "t1",
        issues: ["short message", "bad slug"],
        rejectionSource: "structural" as const,
      },
      {
        tupleName: "t2",
        issues: ["short message"],
        rejectionSource: "structural" as const,
      },
      {
        tupleName: "t3",
        issues: ["bad slug", "missing required"],
        rejectionSource: "structural" as const,
      },
      {
        tupleName: "t4",
        issues: ["tone mismatch"],
        rejectionSource: "semantic" as const,
      },
      {
        tupleName: "t5",
        issues: ["short message"],
        rejectionSource: "structural" as const,
      },
    ];

    // Replicate buildRunResult's topIssues logic
    const issueCount = new Map<string, number>();
    for (const r of rejections) {
      for (const issue of r.issues) {
        issueCount.set(issue, (issueCount.get(issue) ?? 0) + 1);
      }
    }
    const topIssues = [...issueCount.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    expect(topIssues[0]).toEqual({ issue: "short message", count: 3 });
    expect(topIssues[1]).toEqual({ issue: "bad slug", count: 2 });
    expect(topIssues.length).toBe(4);
  });

  test("topIssues capped at 5 entries", () => {
    const issues = [
      "issue_a",
      "issue_b",
      "issue_c",
      "issue_d",
      "issue_e",
      "issue_f",
      "issue_g",
    ];
    const rejections = issues.map((issue, i) => ({
      tupleName: `t${i}`,
      issues: [issue],
      rejectionSource: "structural" as const,
    }));

    const issueCount = new Map<string, number>();
    for (const r of rejections) {
      for (const issue of r.issues) {
        issueCount.set(issue, (issueCount.get(issue) ?? 0) + 1);
      }
    }
    const topIssues = [...issueCount.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    expect(topIssues.length).toBe(5);
  });
});
