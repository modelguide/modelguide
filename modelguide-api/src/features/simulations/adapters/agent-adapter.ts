/**
 * Agent adapter interface — abstraction between the orchestrator
 * and specific agent implementations (Mastra, LiveKit, etc.).
 *
 * The orchestrator drives the conversation loop; the adapter handles
 * agent-provider specifics (message format, tool calling, turn semantics).
 */

export interface AgentAdapterResponse {
  /** The agent's text response. */
  response: string;
  /** Tool calls made by the agent during this turn. */
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }>;
  /**
   * Whether the conversation has ended from the agent's perspective.
   * Single-response adapters (Mastra) always return true.
   * Multi-turn adapters signal based on agent behavior.
   */
  conversationEnded: boolean;
}

export interface AgentAdapter {
  /**
   * Send a user message to the agent and get its response.
   *
   * @param sessionId - The simulation session ID (for tool calls that need it)
   * @param message - The user message to send
   * @param conversationHistory - Optional prior conversation turns for replay tests.
   *   When provided, the adapter passes these as structured messages to the model
   *   so it sees full conversational context before generating a response.
   * @returns The agent's response including any tool calls
   */
  sendMessage(
    sessionId: string,
    message: string,
    conversationHistory?: Array<{ role: string; content: string }>,
  ): Promise<AgentAdapterResponse>;
}
