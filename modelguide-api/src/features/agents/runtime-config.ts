/**
 * Agent runtime config — the narrow view a LiveKit (or any external) worker
 * needs to boot a voice session, fetched via `GET /agents/me/runtime-config`
 * using the agent's own API key.
 *
 * Why a separate endpoint instead of reusing `GET /agents/:id`?
 *   - `/agents/:id` is JWT-only (dashboard users). Agent API keys can't call
 *     it without weakening auth on the management surface.
 *   - The dashboard view leaks fields a worker has no business seeing:
 *     `organizationId`, the full `metadata` blob (LiveKit/ElevenLabs config,
 *     legacy `webhook_hmac_secret`), and the `secrets` ref map.
 *   - Keeping the worker payload minimal means rotating a webhook secret or
 *     adding a new dashboard-only field can't accidentally widen what the
 *     worker observes — the shape is locked by tests in
 *     `tests/unit/agents/runtime-config.test.ts`.
 *
 * See ADR-015 for the worker-fetches-prompt pattern.
 */

import type { Agent } from "@db/schema";

export interface AgentRuntimeConfig {
  id: string;
  name: string;
  slug: string;
  modality: "voice" | "text";
  compiledInstructions: string | null;
  compiledAt: string | null;
  promptConfig: Record<string, unknown>;
}

export function formatAgentRuntimeConfig(agent: Agent): AgentRuntimeConfig {
  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    modality: agent.modality,
    compiledInstructions: agent.compiledInstructions ?? null,
    compiledAt: agent.compiledAt?.toISOString() ?? null,
    promptConfig: (agent.promptConfig ?? {}) as Record<string, unknown>,
  };
}
