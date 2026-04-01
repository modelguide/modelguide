/**
 * Test case generation — per-tuple LLM generation via generateObject().
 *
 * Each tuple produces one GeneratedTestCase with:
 * - name, scenario, customer_message, mock_tool_responses
 */

import { env } from "@/env";
import type { SopStep } from "@features/sops/sops.types";
import { generateObject } from "ai";
import { z } from "zod";
import { resolveGenerationModel } from "./model";
import { parseFields } from "./parse-fields";
import type {
  DimensionTuple,
  GeneratedTestCase,
  TokenUsage,
  ToolStateVariant,
} from "./types";

// ============================================================================
// Zod schema for generated test case
// ============================================================================

/**
 * Some LLM APIs reject z.record() (produces `additionalProperties: { ... }`).
 * Use array-of-entries format and convert back to Record after generation.
 */
const mockFieldSchema = z.object({
  key: z.string().describe("Response field name"),
  value: z.string().describe("Response field value as string"),
});

const mockToolEntrySchema = z.object({
  toolSlug: z.string().describe("Exact tool slug from the SOP"),
  fields: z
    .array(mockFieldSchema)
    .describe("Key-value pairs for this tool's mock response"),
});

const generatedTestCaseSchema = z.object({
  name: z.string().describe("Short descriptive name: intent - tone - edgeCase"),
  scenario: z
    .string()
    .describe(
      "1-2 sentence scenario describing the customer situation and what they want",
    ),
  customer_message: z
    .string()
    .min(20)
    .describe(
      "A realistic customer message (at least 8-15 words, even for terse tones) written in the specified tone, reflecting the edge case. Must be a complete sentence, not just a few words.",
    ),
  mock_tool_responses: z
    .array(mockToolEntrySchema)
    .describe(
      "Mock responses as array of { toolSlug, fields } entries. Copy the tool states provided in the prompt.",
    ),
});

// ============================================================================
// generateTestCase
// ============================================================================

/**
 * Generate a single test case from a dimension tuple and SOP context.
 *
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
      : "\nNo tools — mock_tool_responses should be an empty array [].";

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
1. "name" should be exactly: "${tuple.intent} - ${tuple.tone} - ${tuple.edgeCase}"
2. "scenario" — 1-2 sentences describing the customer's situation
3. "customer_message" — write a realistic customer message (minimum 8 words) that:
   ${toneGuidance}
   ${edgeCaseGuidance}
4. "mock_tool_responses" — array of { toolSlug, fields: [{ key, value }] } entries.
   CRITICAL: toolSlug values MUST exactly match the tool slugs from the SOP steps above. Do not invent new slugs.
   Copy the exact tool states provided above. If no tools, return an empty array [].

The message should feel like a real customer wrote it, not a template.`;

  const { object, usage } = await generateObject({
    model: resolveGenerationModel(env.GENERATION_CASE_MODEL),
    schema: generatedTestCaseSchema,
    prompt,
  });

  // Convert array-of-entries back to Record<slug, ToolStateVariant>
  const mockToolResponses: Record<string, ToolStateVariant> = {};
  for (const entry of object.mock_tool_responses) {
    mockToolResponses[entry.toolSlug] = parseFields(entry.fields);
  }

  const testCase: GeneratedTestCase = {
    name: object.name,
    scenario: object.scenario,
    customer_message: object.customer_message,
    mock_tool_responses: mockToolResponses,
  };

  return {
    testCase,
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
      return "- Write briefly and directly, no pleasantries, but still a complete sentence (8+ words)";
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
      return "- Do NOT include an order number in the message";
    case "contradictory_request":
      return "- Include contradictory information (e.g., want refund but also replacement)";
    case "tool_returns_error":
      return "- Write normally — the mock tool will return an error for the agent to handle";
    case "multiple_issues_single_email":
      return "- Include 2-3 separate issues in one message";
    case "out_of_scope_request":
      return "- Ask for something outside this SOP's scope";
    default:
      return `- Incorporate the "${edgeCase}" edge case naturally into the message`;
  }
}
