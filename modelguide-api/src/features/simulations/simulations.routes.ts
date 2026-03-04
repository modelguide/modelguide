/**
 * Simulation routes — admin-only endpoints for persona simulation.
 */

import { createRoute } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getOrganizationId,
  requireOrganization,
  requireUser,
} from "@lib/middleware";
import { requirePermission } from "@lib/middleware/rbac";
import { errorResponse } from "@lib/schemas";
import {
  listPersonasResponseSchema,
  runSimulationBody,
  simulationResultSchema,
} from "./simulations.schemas";
import { listPersonas, startSimulation } from "./simulations.service";

const router = createRouter();

// ============================================================================
// Middleware
// ============================================================================

router.post(
  "/run",
  requireUser(),
  requirePermission("simulations:run"),
  requireOrganization(),
);
router.get(
  "/personas",
  requireUser(),
  requirePermission("simulations:read"),
  requireOrganization(),
);

// ============================================================================
// Routes
// ============================================================================

const runSimulationRoute = createRoute({
  method: "post",
  path: "/run",
  tags: ["Simulations"],
  summary: "Run persona simulation",
  description:
    "Starts a simulated conversation between a persona (LLM-as-customer) and an agent. Returns the simulation result with session ID.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: runSimulationBody } },
    },
  },
  responses: {
    200: {
      description: "Simulation completed",
      content: { "application/json": { schema: simulationResultSchema } },
    },
    422: errorResponse("Invalid input"),
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Agent or persona not found"),
    503: errorResponse("Simulation LLM not configured"),
  },
});

router.openapi(runSimulationRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { agentId, personaId, maxTurns } = c.req.valid("json");

  const result = await startSimulation(orgId, agentId, personaId, maxTurns);
  return c.json(result, 200);
});

const listPersonasRoute = createRoute({
  method: "get",
  path: "/personas",
  tags: ["Simulations"],
  summary: "List available personas",
  description: "Returns all built-in personas available for simulation runs.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Personas list",
      content: { "application/json": { schema: listPersonasResponseSchema } },
    },
    401: errorResponse("Not authenticated"),
  },
});

router.openapi(listPersonasRoute, async (c) => {
  const data = listPersonas();
  return c.json({ data }, 200);
});

export default router;
