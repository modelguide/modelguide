/**
 * Test case validation — structural checks + LLM-based semantic validation.
 */

import { env } from "@/env";
import type { SopStep } from "@features/sops/sops.types";
import { generateObject } from "ai";
import { z } from "zod";
import { resolveGenerationModel } from "./model";
import type { GeneratedTestCase, TokenUsage, ValidationResult } from "./types";

// ============================================================================
// Semantic validation schema
// ============================================================================

const semanticValidationSchema = z.object({
  passes: z
    .boolean()
    .describe("Whether the test case is internally consistent"),
  issues: z
    .array(z.string())
    .describe("List of consistency issues found, empty if passes is true"),
});

// ============================================================================
// Structural validation (no LLM)
// ============================================================================

/**
 * Run structural checks on a generated test case.
 *
 * Rejects when:
 * (a) mock tool slug doesn't match any SOP tool reference
 * (b) a required SOP tool has no mock response
 * (c) input_email is fewer than 5 words
 */
export function validateStructural(
  testCase: GeneratedTestCase,
  steps: SopStep[],
): ValidationResult {
  const issues: string[] = [];

  // Extract tool slugs from SOP steps
  const sopToolSlugs = new Set<string>();
  const requiredToolSlugs = new Set<string>();
  for (const step of steps) {
    if (step.tool?.resolvedName) {
      sopToolSlugs.add(step.tool.resolvedName);
      if (step.required) {
        requiredToolSlugs.add(step.tool.resolvedName);
      }
    }
  }

  // (a) Check mock tool slugs match SOP tool references
  for (const mockSlug of Object.keys(testCase.mock_tool_responses)) {
    if (!sopToolSlugs.has(mockSlug)) {
      issues.push(
        `Mock tool slug "${mockSlug}" doesn't match any SOP tool reference`,
      );
    }
  }

  // (b) Check required SOP tools have mock responses
  for (const requiredSlug of requiredToolSlugs) {
    if (!(requiredSlug in testCase.mock_tool_responses)) {
      issues.push(`Required tool "${requiredSlug}" has no mock response`);
    }
  }

  // (c) Check input_email word count
  const wordCount = testCase.input_email.trim().split(/\s+/).length;
  if (wordCount < 5) {
    issues.push("input_email too short — likely degenerate");
  }

  return {
    valid: issues.length === 0,
    issues,
    source: issues.length > 0 ? "structural" : null,
  };
}

// ============================================================================
// Semantic validation (LLM-based)
// ============================================================================

/**
 * Validate internal consistency of a generated test case via LLM
 * (model configurable via GENERATION_CASE_MODEL).
 *
 * Checks that the email matches the scenario and mock data make sense together.
 */
export async function validateSemantic(
  testCase: GeneratedTestCase,
): Promise<{ result: ValidationResult; usage: TokenUsage }> {
  const prompt = `Evaluate the internal consistency of this generated test case for an AI agent evaluation suite.

Test case:
- Name: ${testCase.name}
- Scenario: ${testCase.scenario}
- Customer email: "${testCase.input_email}"
- Mock tool responses: ${JSON.stringify(testCase.mock_tool_responses)}

Check for:
1. Does the email match the described scenario?
2. Does the email tone match what the name suggests?
3. Are the mock tool responses consistent with the scenario?
4. Is the email realistic and could plausibly be from a real customer?
5. Does the email contain enough context for an agent to respond?

Set "passes" to true if the test case is internally consistent. Only flag real issues — minor style differences are acceptable.`;

  const { object, usage } = await generateObject({
    model: resolveGenerationModel(env.GENERATION_CASE_MODEL),
    schema: semanticValidationSchema,
    prompt,
  });

  return {
    result: {
      valid: object.passes,
      issues: object.issues,
      source: object.passes ? null : "semantic",
    },
    usage: {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
    },
  };
}
