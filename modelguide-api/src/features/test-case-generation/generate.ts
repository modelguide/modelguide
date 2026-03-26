/**
 * Test case generation — per-tuple LLM generation via Haiku generateObject().
 *
 * Each tuple produces one GeneratedTestCase with:
 * - name, scenario, input_email, mock_tool_responses
 *
 * AC 7: validates output against Zod schema via generateObject()
 * AC 8: mock_tool_responses keys match SOP tool slugs
 * AC 9: input_email reflects tuple tone and edge case
 */

import { env } from "@/env";
import { anthropic } from "@ai-sdk/anthropic";
import type { SopStep } from "@features/sops/sops.types";
import { generateObject } from "ai";
import { z } from "zod";
import type { DimensionTuple, GeneratedTestCase, TokenUsage } from "./types";

// ============================================================================
// Zod schema for generated test case
// ============================================================================

const generatedTestCaseSchema = z.object({
  name: z.string().describe("Short descriptive name: intent - tone - edgeCase"),
  scenario: z
    .string()
    .describe(
      "1-2 sentence scenario describing the customer situation and what they want",
    ),
  input_email: z
    .string()
    .describe(
      "A realistic customer email (at least 5 words) written in the specified tone, reflecting the edge case",
    ),
  mock_tool_responses: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .describe(
      "Mock responses keyed by tool slug, matching the provided tool states",
    ),
});

// ============================================================================
// generateTestCase (AC 7, AC 8, AC 9)
// ============================================================================

/**
 * Generate a single test case from a dimension tuple and SOP context.
 *
 * Uses Haiku generateObject() for fast, cheap generation.
 * Returns the generated case and token usage.
 */
export async function generateTestCase(
  tuple: DimensionTuple,
  sopName: string,
  steps: SopStep[],
): Promise<{ testCase: GeneratedTestCase; usage: TokenUsage }> {
  const stepsDescription = steps
    .map((s, i) => {
      const toolInfo = s.tool?.resolvedName
        ? ` [tool: ${s.tool.resolvedName}]`
        : "";
      return `${i + 1}. ${s.instruction}${toolInfo}`;
    })
    .join("\n");

  const toolStateInfo =
    Object.keys(tuple.toolState).length > 0
      ? `\nTool states to use as mock_tool_responses:\n${JSON.stringify(tuple.toolState, null, 2)}`
      : "\nNo tools — mock_tool_responses should be an empty object {}.";

  const toneGuidance = getToneGuidance(tuple.tone);
  const edgeCaseGuidance = getEdgeCaseGuidance(tuple.edgeCase);

  const prompt = `Generate a realistic customer support test case for this scenario.

SOP: ${sopName}
Steps:
${stepsDescription}

Dimension tuple:
- Intent: ${tuple.intent}
- Tone: ${tuple.tone}
- Complexity: ${tuple.complexity}
- Edge case: ${tuple.edgeCase}
${toolStateInfo}

Requirements:
1. "name" should be: "${tuple.intent} - ${tuple.tone} - ${tuple.edgeCase}"
2. "scenario" — 1-2 sentences describing the customer's situation
3. "input_email" — write a realistic customer email (minimum 5 words) that:
   ${toneGuidance}
   ${edgeCaseGuidance}
4. "mock_tool_responses" — copy the exact tool states provided above. Keys must match tool slugs exactly.
   If no tools, return an empty object {}.

The email should feel like a real customer wrote it, not a template.`;

  const { object, usage } = await generateObject({
    model: anthropic(env.GENERATION_CASE_MODEL),
    schema: generatedTestCaseSchema,
    prompt,
  });

  return {
    testCase: object as GeneratedTestCase,
    usage: {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
    },
  };
}

// ============================================================================
// Tone & edge case guidance helpers
// ============================================================================

function getToneGuidance(tone: string): string {
  switch (tone) {
    case "frustrated":
      return "- Write with visible frustration, use urgent language, express dissatisfaction";
    case "hostile":
      return '- Write with hostile language, demands, threats of bad reviews or "speak to manager"';
    case "confused":
      return "- Write with uncertainty, ask multiple questions, use vague descriptions";
    case "polite":
      return '- Write politely with greetings, "please" and "thank you"';
    case "terse":
      return "- Write very briefly, minimal words, no pleasantries";
    default:
      return "- Write in a neutral customer tone";
  }
}

function getEdgeCaseGuidance(edgeCase: string): string {
  switch (edgeCase) {
    case "straightforward":
      return "- Make the request clear and unambiguous";
    case "ambiguous_intent":
      return "- Make the request unclear so the agent must clarify";
    case "missing_order_number":
      return "- Do NOT include an order number in the email";
    case "contradictory_request":
      return "- Include contradictory information (e.g., want refund but also replacement)";
    case "tool_returns_error":
      return "- Write normally — the mock tool will return an error for the agent to handle";
    case "multiple_issues_single_email":
      return "- Include 2-3 separate issues in one email";
    case "out_of_scope_request":
      return "- Ask for something outside this SOP's scope";
    default:
      return `- Incorporate the "${edgeCase}" edge case naturally into the email`;
  }
}
