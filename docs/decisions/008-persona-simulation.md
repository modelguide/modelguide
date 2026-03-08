# ADR-006: Persona Simulation

**Status:** Accepted

## Context

ModelGuide agents are tested manually — an admin sends messages through the MCP interface or API and visually inspects the responses. This is slow, non-repeatable, and provides no baseline for regression detection. We need an automated way to simulate realistic customer conversations against configured agents so that teams can validate agent behavior before deploying changes.

Key questions this decision addresses:

1. Which LLM interface should drive the simulation?
2. How should the simulation loop work?
3. Where should simulation sessions be stored — alongside live sessions or in a separate table?

## Decision

### LLM interface: OpenAI-compatible API

The simulation engine uses the OpenAI Chat Completions API format (via the `openai` npm package) for both the persona (simulated customer) and the agent-under-test. Rationale:

- **Provider flexibility:** The OpenAI SDK supports any OpenAI-compatible endpoint (Anthropic via proxy, Ollama, Azure OpenAI, etc.) through the `baseURL` config. This avoids locking the simulation to a single provider.
- **Tool calling support:** OpenAI's function-calling format is well-established and maps directly to our existing MCP tool definitions via a thin adapter (`toOpenAiTools`).
- **Separation from production:** Simulation uses its own API key and model config (`SIMULATION_LLM_API_KEY`, `SIMULATION_LLM_BASE_URL`, `SIMULATION_LLM_MODEL`), independent of whatever LLM the real agent uses.

Trade-off: adds `openai` as a production dependency. Mitigated by keeping it isolated to the `simulations` feature module.

### Simulation loop design

The orchestrator drives a turn-based conversation loop:

1. **Persona turn:** An LLM generates a customer message using a persona system prompt (personality, scenario, goals). The conversation history is role-inverted so the persona LLM naturally continues as the customer.
2. **Agent turn:** A second LLM call generates the agent response with tool-calling enabled. If tools are called, they are executed against real connector handlers (with resolved config), and a follow-up response is generated.
3. **Termination:** The loop ends when the persona's message matches a conversation-ending heuristic (word-boundary regex matching), the turn limit is reached, or an unrecoverable error occurs.

Personas are defined as static TypeScript objects with `id`, `name`, `systemPrompt`, `traits`, and optional `maxTurns`. This keeps them version-controlled and reviewable.

### Session storage: alongside live sessions

Simulation sessions are stored in the existing `sessions` and `session_messages` tables, distinguished by a `mode` column (`session_mode` enum: `live` | `simulation`). Rationale:

- **Reuse:** Session transcript viewing, message storage, and feedback features work without modification.
- **Analytics:** Simulation sessions can be included in or excluded from analytics by filtering on `mode`.
- **Simplicity:** No schema duplication or separate query paths.

The `userIdentifier` follows the pattern `simulation:{personaId}` for easy identification. Session metadata stores `personaId` and `personaName` for traceability.

## Consequences

- **New dependency:** `openai` npm package added to production deps (used only by the `simulations` feature).
- **New DB enum:** `session_mode` enum added with migration; existing sessions default to `live`.
- **New RBAC permissions:** `simulations:run` (admin-only) and `simulations:read` (admin + support) added to the permission system.
- **Cost awareness:** Each simulation run makes multiple LLM API calls. The `maxTurns` parameter (default from env, capped at 50) provides a cost ceiling.
- **Claude support:** Claude is supported out of the box via Anthropic's [OpenAI SDK compatibility endpoint](https://docs.claude.com/en/api/openai-sdk). Set `SIMULATION_LLM_BASE_URL=https://api.anthropic.com/v1/` and `SIMULATION_LLM_MODEL=claude-sonnet-4-6`. **Edge case — `strict` mode ignored:** When using OpenAI's function-calling format, the `strict` parameter guarantees tool call arguments conform exactly to the JSON Schema. Anthropic's compatibility layer ignores this flag, meaning Claude may produce arguments with missing required fields, extra fields, or wrong types. The simulation engine handles this gracefully: `JSON.parse` calls in `llm-client.ts` are wrapped in try/catch and fall back to `{}` with a warning log, so a malformed tool call degrades to a no-op rather than crashing the simulation loop. If strict schema conformance is critical (e.g. for tools that break on unexpected input), consider using the native Anthropic SDK with [Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use#structured-outputs) in a future iteration.
- **Future work:** UI for triggering and reviewing simulation runs. Automated scoring/evaluation of simulation transcripts.
