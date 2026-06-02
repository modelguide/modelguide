/**
 * Build the JSON payload returned by `GET /api/agents/me/prompt`.
 *
 * The endpoint is reached by an authenticated agent worker (API key auth) at
 * the start of every session. The worker uses the returned compiled prompt
 * as the LLM system instructions — the whole point is that "click compile in
 * the dashboard" propagates to the very next voice-test call without a
 * worker redeploy.
 *
 * This is a pure function so the response shape is unit-tested. The Python
 * prototype's `PromptFetcher` decodes the exact same fields
 * (see examples/agents/livekit-prototype/src/prompt_fetcher.py).
 */
export interface AgentPromptPayload {
  agent: {
    id: string;
    slug: string;
    name: string;
    modality: string;
  };
  compiledInstructions: string | null;
  compiledAt: string | null;
  promptConfig: Record<string, unknown>;
}

interface AgentRowShape {
  id: string;
  slug: string;
  name: string;
  modality: string;
  compiledInstructions: string | null;
  compiledAt: Date | string | null;
  // Loose typing on purpose — `agents.promptConfig` is a Drizzle jsonb column
  // typed as `PromptConfig`, but the wire payload is intentionally a plain
  // object so worker-side validators don't have to know our internal type.
  promptConfig?: object | null;
}

export function buildAgentPromptPayload(
  agent: AgentRowShape,
): AgentPromptPayload {
  const compiledAt =
    agent.compiledAt instanceof Date
      ? agent.compiledAt.toISOString()
      : (agent.compiledAt ?? null);

  return {
    agent: {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      modality: agent.modality,
    },
    compiledInstructions: agent.compiledInstructions ?? null,
    compiledAt,
    promptConfig: (agent.promptConfig as Record<string, unknown>) ?? {},
  };
}
