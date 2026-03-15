/**
 * Zod schemas for simulation API endpoints.
 */

import { z } from "@hono/zod-openapi";

export const runSimulationBody = z.object({
  agentId: z
    .string()
    .uuid()
    .openapi({ description: "ID of the agent to simulate" }),
  personaId: z.string().openapi({
    description: "Persona identifier (e.g. 'polite-buyer')",
    example: "polite-buyer",
  }),
  maxTurns: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .openapi({ description: "Maximum conversation turns (default: 20)" }),
});

export const simulationResultSchema = z.object({
  sessionId: z.string().uuid(),
  personaId: z.string(),
  turnCount: z.number(),
  status: z.enum(["completed", "max_turns_reached", "error"]),
  durationMs: z.number(),
  error: z.string().optional(),
});

export const personaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  traits: z.array(z.string()),
});

export const listPersonasResponseSchema = z.object({
  data: z.array(personaSchema),
});
