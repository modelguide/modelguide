/**
 * Compiler API routes — compile an agent from a SOP.
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getOrganizationId,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { errorResponse } from "@lib/schemas";

import { compileAgent } from "./compiler.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const compileAgentParams = z.object({
  agentId: z.string().uuid().openapi({ description: "Agent ID" }),
});

const compileAgentQuerySchema = z.object({
  dryRun: z.coerce.boolean().optional().openapi({
    description:
      "When true, runs the full pipeline but skips persisting. Useful for preview/diff.",
  }),
});

const compileAgentBodySchema = z.object({
  sopId: z.string().uuid().openapi({ description: "SOP ID to compile from" }),
  model: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: "Override model for compilation" }),
  description: z
    .string()
    .max(2000)
    .optional()
    .openapi({ description: "Override agent description/role context" }),
});

const compileAgentResponseSchema = z.object({
  agentId: z.string().uuid(),
  compiledAt: z.string(),
  compiledFrom: z.record(z.unknown()),
  compiledPrompt: z.string(),
  promptLength: z.number(),
  toolCount: z.number(),
});

// ============================================================================
// Middleware
// ============================================================================

router.post(
  "/agents/:agentId/compile",
  requireUser(),
  requirePermission("agents:update"),
  requireOrganization(),
);

// ============================================================================
// Routes
// ============================================================================

const compileRoute = createRoute({
  method: "post",
  path: "/agents/{agentId}/compile",
  tags: ["Compiler"],
  summary: "Compile agent from SOP",
  description:
    "Compiles an agent's system prompt from a SOP + guardrails and persists the compiled instructions.",
  security: [{ bearerAuth: [] }],
  request: {
    params: compileAgentParams,
    query: compileAgentQuerySchema,
    body: {
      content: { "application/json": { schema: compileAgentBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Agent compiled successfully",
      content: {
        "application/json": { schema: compileAgentResponseSchema },
      },
    },
    404: errorResponse("Agent or SOP not found"),
    422: errorResponse("Invalid SOP definition or guardrail config"),
  },
});

router.openapi(compileRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { agentId } = c.req.valid("param");
  const { dryRun } = c.req.valid("query");
  const body = c.req.valid("json");

  const result = await compileAgent({
    orgId,
    agentId,
    sopId: body.sopId,
    agentModel: body.model,
    agentDescription: body.description,
    dryRun: dryRun === true,
  });

  if (!dryRun && !result.agent) {
    throw new Error("Compilation succeeded but agent update failed");
  }

  const compiledFrom = dryRun
    ? (result.compiledFrom as Record<string, unknown>)
    : (result.agent!.compiledFrom as Record<string, unknown>);

  return c.json(
    {
      agentId,
      compiledAt: dryRun
        ? new Date().toISOString()
        : result.agent!.compiledAt!.toISOString(),
      compiledFrom,
      compiledPrompt: result.ir.systemPrompt,
      promptLength: result.ir.systemPrompt.length,
      toolCount: result.ir.tools.length,
    },
    200,
  );
});

export default router;
