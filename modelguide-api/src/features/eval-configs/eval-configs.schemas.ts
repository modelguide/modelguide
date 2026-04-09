/**
 * Zod schemas for eval config API validation.
 */

import { z } from "zod";
import type { EvaluatorType, StepEvaluatorConfig } from "../evals/evals.types";

// ============================================================================
// Shared sub-schemas
// ============================================================================

const assertionSchema = z.object({
  op: z.enum(["equals", "contains", "gt", "lt", "exists", "matches"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const evaluatorTypeEnum = z.enum([
  "tool_called",
  "tool_input_contains",
  "no_tool_called",
  "llm_judge",
]);

// ============================================================================
// Config JSONB schemas per evaluator type
// ============================================================================

const connectorToolConfigSchema = z
  .object({
    connectorToolId: z.string().uuid(),
  })
  .strict();

const toolInputContainsConfigSchema = z
  .object({
    connectorToolId: z.string().uuid(),
    assertions: z
      .record(z.string(), assertionSchema)
      .refine((a) => Object.keys(a).length > 0, {
        message: "At least one assertion is required",
      }),
  })
  .strict();

const llmJudgeConfigSchema = z
  .object({
    criterion: z
      .string()
      .min(1, "Criterion is required")
      .max(2000, "Criterion must be 2000 characters or less"),
    rubric: z
      .object({
        pass: z.string().min(1).max(500),
        fail: z.string().min(1).max(500),
      })
      .optional(),
    model: z.string().max(100).optional(),
    skipOnFailure: z.boolean().optional(),
  })
  .strict();

// ============================================================================
// Config validation
// ============================================================================

const CONFIG_SCHEMA_MAP = {
  tool_called: connectorToolConfigSchema,
  tool_input_contains: toolInputContainsConfigSchema,
  no_tool_called: connectorToolConfigSchema,
  llm_judge: llmJudgeConfigSchema,
} as const;

/** Validate config JSONB against the evaluator type's schema. Exported for use in update path. */
export function validateEvalConfig(
  evaluatorType: string,
  config: Record<string, unknown>,
): z.ZodIssue[] {
  const schema =
    CONFIG_SCHEMA_MAP[evaluatorType as keyof typeof CONFIG_SCHEMA_MAP];
  if (!schema) {
    return [
      {
        code: "custom" as const,
        message: `Unknown evaluator type: "${evaluatorType}"`,
        path: [],
        params: {},
      },
    ];
  }
  const result = schema.safeParse(config);
  return result.success ? [] : result.error.issues;
}

/** Parse JSONB config into the typed evaluator union used at runtime. */
export function parseStepEvaluatorConfig(
  evaluatorType: EvaluatorType,
  config: Record<string, unknown>,
):
  | { success: true; config: StepEvaluatorConfig }
  | { success: false; issues: z.ZodIssue[] } {
  switch (evaluatorType) {
    case "tool_called": {
      const result = connectorToolConfigSchema.safeParse(config);
      return result.success
        ? { success: true, config: { type: "tool_called", ...result.data } }
        : { success: false, issues: result.error.issues };
    }
    case "tool_input_contains": {
      const result = toolInputContainsConfigSchema.safeParse(config);
      return result.success
        ? {
            success: true,
            config: { type: "tool_input_contains", ...result.data },
          }
        : { success: false, issues: result.error.issues };
    }
    case "no_tool_called": {
      const result = connectorToolConfigSchema.safeParse(config);
      return result.success
        ? { success: true, config: { type: "no_tool_called", ...result.data } }
        : { success: false, issues: result.error.issues };
    }
    case "llm_judge": {
      const result = llmJudgeConfigSchema.safeParse(config);
      return result.success
        ? { success: true, config: { type: "llm_judge", ...result.data } }
        : { success: false, issues: result.error.issues };
    }
  }
}

// ============================================================================
// Request schemas
// ============================================================================

export const createEvalConfigSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    evaluatorType: evaluatorTypeEnum,
    config: z.record(z.string(), z.unknown()),
    tags: z.array(z.string().min(1).max(100)).max(20).default([]),
  })
  .superRefine((data, ctx) => {
    for (const issue of validateEvalConfig(data.evaluatorType, data.config)) {
      ctx.addIssue({ ...issue, path: ["config", ...issue.path] });
    }
  });

export const updateEvalConfigSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.config !== undefined ||
      data.tags !== undefined,
    { message: "At least one field must be provided" },
  );

export const evalConfigListQuerySchema = z.object({
  evaluatorType: evaluatorTypeEnum.optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// Response schemas
// ============================================================================

export const evalConfigResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  evaluatorType: z.string(),
  config: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});
