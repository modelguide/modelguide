/**
 * Zod schemas for eval config API validation.
 */

import { z } from "zod";

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
  if (!schema) return [];
  const result = schema.safeParse(config);
  return result.success ? [] : result.error.issues;
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
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.config !== undefined,
    { message: "At least one field must be provided" },
  );

export const evalConfigListQuerySchema = z.object({
  evaluatorType: evaluatorTypeEnum.optional(),
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
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});
