/**
 * Zod schemas for eval import — supports two input formats:
 *
 * 1. YAML (evals.yaml): Separate evaluators + test_cases sections
 * 2. JSON (eval-scenarios.json): Flat scenarios with inline criteria
 *
 * Both are normalized to NormalizedEvalsInput for the handler.
 */

import { z } from "zod";

// ============================================================================
// Shared building blocks
// ============================================================================

const messageRoles = ["user", "assistant", "system", "tool"] as const;

const conversationMessageSchema = z.object({
  role: z.enum(messageRoles),
  content: z.string().min(1),
});

/**
 * Input block — accepts either candidate_message or customer_message,
 * plus optional conversation history, context, and persona.
 */
const evalInputSchema = z
  .object({
    candidate_message: z.string().min(1).optional(),
    customer_message: z.string().min(1).optional(),
    conversation_history: z.array(conversationMessageSchema).optional(),
    context: z.record(z.unknown()).optional(),
    persona: z.string().optional(),
  })
  .refine(
    (data) => data.candidate_message || data.customer_message,
    "Either candidate_message or customer_message is required",
  );

// ============================================================================
// YAML format — separate evaluators + test_cases sections
// ============================================================================

const yamlEvaluatorSchema = z.object({
  name: z.string().min(1).max(255),
  criterion: z.string().min(1),
  tags: z.array(z.string().min(1).max(100)).default([]),
});

const yamlTestCaseSchema = z.object({
  id: z.string().min(1).max(255),
  sop_slug: z.string().min(1),
  scenario_key: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  guardrails_tested: z.array(z.string()).default([]),
  evaluators: z.array(z.string().min(1)).min(1),
  input: evalInputSchema,
  mock_tool_responses: z.record(z.unknown()).optional(),
});

export const evalsYamlFileSchema = z
  .object({
    agentSlug: z.string().min(1),
    evaluators: z.array(yamlEvaluatorSchema).min(1),
    /**
     * Evaluator names that should run on every test case in every suite for
     * this agent — typically guardrail-style checks like `does-not-fabricate`
     * that apply regardless of scenario. Attached at the suite level by the
     * importer, so the dashboard's "Evaluators" tab shows them.
     */
    common_evaluators: z.array(z.string().min(1)).default([]),
    test_cases: z.array(yamlTestCaseSchema).min(1),
  })
  .refine(
    (data) => {
      const definedNames = new Set(data.evaluators.map((e) => e.name));
      const referenced = [
        ...data.test_cases.flatMap((tc) => tc.evaluators),
        ...data.common_evaluators,
      ];
      const missing = referenced.filter((name) => !definedNames.has(name));
      return missing.length === 0;
    },
    (data) => {
      const definedNames = new Set(data.evaluators.map((e) => e.name));
      const referenced = [
        ...data.test_cases.flatMap((tc) => tc.evaluators),
        ...data.common_evaluators,
      ];
      const missing = [
        ...new Set(referenced.filter((name) => !definedNames.has(name))),
      ];
      return {
        message: `Test cases reference undefined evaluators: ${missing.join(", ")}`,
      };
    },
  );

// ============================================================================
// JSON format — flat scenarios with inline criteria (external eval repos)
// ============================================================================

const jsonEvalScenarioSchema = z.object({
  id: z.string().min(1).max(255),
  description: z.string().optional(),
  scenario_key: z.string().optional(),
  sop_slug: z.string().min(1),
  input: evalInputSchema,
  expected_output: z.object({
    criteria: z.array(z.string().min(1)).min(1),
  }),
  guardrails_tested: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const evalScenariosJsonSchema = z.array(jsonEvalScenarioSchema).min(1);

// ============================================================================
// Normalized internal representation
// ============================================================================

export interface NormalizedEvaluator {
  name: string;
  criterion: string;
  tags: string[];
}

export interface NormalizedTestCase {
  id: string;
  sopSlug: string;
  scenarioKey?: string;
  description?: string;
  tags: string[];
  guardrailsTested: string[];
  evaluatorNames: string[];
  input: {
    message: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    context?: Record<string, unknown>;
    persona?: string;
  };
  mockToolResponses?: Record<string, unknown>;
}

export interface NormalizedEvalsInput {
  agentSlug: string;
  evaluators: NormalizedEvaluator[];
  /** Evaluator names to attach at the suite level of every suite (from yaml `common_evaluators`). */
  commonEvaluatorNames: string[];
  testCases: NormalizedTestCase[];
}

// ============================================================================
// Normalization helpers
// ============================================================================

function normalizeMessage(input: {
  candidate_message?: string;
  customer_message?: string;
}): string {
  return (input.customer_message ?? input.candidate_message)!;
}

/** Slugify a criterion string into a short evaluator name. */
function criterionToName(criterion: string): string {
  return criterion
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Convert parsed YAML to normalized form. */
export function normalizeYaml(
  parsed: z.infer<typeof evalsYamlFileSchema>,
): NormalizedEvalsInput {
  return {
    agentSlug: parsed.agentSlug,
    evaluators: parsed.evaluators.map((e) => ({
      name: e.name,
      criterion: e.criterion,
      tags: e.tags,
    })),
    commonEvaluatorNames: parsed.common_evaluators,
    testCases: parsed.test_cases.map((tc) => ({
      id: tc.id,
      sopSlug: tc.sop_slug,
      scenarioKey: tc.scenario_key,
      description: tc.description,
      tags: tc.tags,
      guardrailsTested: tc.guardrails_tested,
      evaluatorNames: tc.evaluators,
      input: {
        message: normalizeMessage(tc.input),
        conversationHistory: tc.input.conversation_history,
        context: tc.input.context,
        persona: tc.input.persona,
      },
      mockToolResponses: tc.mock_tool_responses,
    })),
  };
}

/** Convert parsed JSON scenarios to normalized form. Auto-extracts evaluators from criteria. */
export function normalizeJson(
  scenarios: z.infer<typeof evalScenariosJsonSchema>,
  agentSlug: string,
): NormalizedEvalsInput {
  // Collect unique criteria across all scenarios
  const criteriaMap = new Map<string, string>(); // criterion → name
  for (const scenario of scenarios) {
    for (const criterion of scenario.expected_output.criteria) {
      if (!criteriaMap.has(criterion)) {
        criteriaMap.set(criterion, criterionToName(criterion));
      }
    }
  }

  // Handle duplicate names by appending a suffix
  const nameCount = new Map<string, number>();
  const uniqueNames = new Map<string, string>(); // criterion → unique name
  for (const [criterion, baseName] of criteriaMap) {
    const count = nameCount.get(baseName) ?? 0;
    const name = count === 0 ? baseName : `${baseName}-${count}`;
    nameCount.set(baseName, count + 1);
    uniqueNames.set(criterion, name);
  }

  const evaluators: NormalizedEvaluator[] = [];
  for (const [criterion, name] of uniqueNames) {
    evaluators.push({ name, criterion, tags: [] });
  }

  return {
    agentSlug,
    evaluators,
    commonEvaluatorNames: [],
    testCases: scenarios.map((s) => ({
      id: s.id,
      sopSlug: s.sop_slug,
      scenarioKey: s.scenario_key,
      description: s.description,
      tags: s.tags,
      guardrailsTested: s.guardrails_tested,
      evaluatorNames: s.expected_output.criteria.map(
        (c) => uniqueNames.get(c)!,
      ),
      input: {
        message: normalizeMessage(s.input),
        conversationHistory: s.input.conversation_history,
        context: s.input.context,
        persona: s.input.persona,
      },
    })),
  };
}
