/**
 * Simulation service — validates inputs and delegates to the orchestrator.
 */

import { env } from "@/env";
import { getAgentById } from "@features/agents/agents.service";
import { Errors } from "@lib/errors";
import type { SimulationResult } from "./orchestrator";
import { runSimulation } from "./orchestrator";
import { getPersona, listPersonas as listAllPersonas } from "./personas";

export async function startSimulation(
  orgId: string,
  agentId: string,
  personaId: string,
  maxTurns?: number,
): Promise<SimulationResult> {
  // Validate persona exists
  const persona = getPersona(personaId);
  if (!persona) {
    throw Errors.personaNotFound(personaId);
  }

  // Validate agent exists and is active
  const agent = await getAgentById(orgId, agentId);
  if (!agent.isActive) {
    throw Errors.agentInactive(agentId);
  }

  // Fail fast if LLM is not configured
  if (!env.SIMULATION_LLM_API_KEY) {
    throw Errors.simulationLlmNotConfigured();
  }

  return runSimulation({ orgId, agentId, persona, maxTurns });
}

export function listPersonas() {
  return listAllPersonas().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    traits: p.traits,
  }));
}
