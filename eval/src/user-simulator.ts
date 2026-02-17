import type { LLMClient } from "./clients/llm-client.js";
import type { PersonaConfig } from "./config/schemas.js";
import type { ConversationMessage } from "./types.js";

interface UserSimulatorConfig {
  persona: PersonaConfig;
  taskIntent: string;
  hiddenContext: Record<string, unknown>;
  llmClient: LLMClient;
}

export class UserSimulator {
  private config: UserSimulatorConfig;
  private turnCount = 0;

  constructor(config: UserSimulatorConfig) {
    this.config = config;
  }

  async generateMessage(history: ConversationMessage[]): Promise<string> {
    this.turnCount++;

    const systemPrompt = this.buildSystemPrompt();

    const messages: ConversationMessage[] = [
      {
        role: "system",
        content: systemPrompt,
        timestamp: new Date().toISOString(),
      },
      ...history.filter((m) => m.role !== "system"),
    ];

    const response = await this.config.llmClient.chat(messages);
    return response.message.content;
  }

  shouldStop(history: ConversationMessage[]): boolean {
    const stopConds = this.config.persona.stop_conditions;

    // Max turns reached
    if (this.turnCount >= stopConds.max_turns) {
      return true;
    }

    // Check for resolution signals in last assistant message
    const lastAssistant = [...history]
      .reverse()
      .find((m) => m.role === "assistant");

    if (lastAssistant) {
      // Don't stop on resolution/escalation keywords if no tool calls have
      // happened yet. The agent merely *mentioning* resolution or escalation
      // in its first response (e.g. "I want to help get this resolved" or
      // "this will need to be escalated") isn't the same as having actually
      // taken action. Require at least one tool call before these conditions
      // can fire, giving the agent time to verify identity, look up the order,
      // and perform the action.
      const hasToolCalls = history.some(
        (m) => m.role === "assistant" && m.toolCalls?.length,
      );

      if (stopConds.on_resolution && hasToolCalls) {
        const resolutionPatterns = [
          /\b(resolved|completed|taken care of|all set|anything else)\b/i,
          /\b(is there anything else|can I help you with anything)\b/i,
        ];
        if (resolutionPatterns.some((p) => p.test(lastAssistant.content))) {
          return true;
        }
      }

      if (stopConds.on_escalation && hasToolCalls) {
        const escalationPatterns = [
          /\b(escalat|supervisor|manager|transfer)\b/i,
          /\b(I('m| am) (going to |)transfer)\b/i,
        ];
        if (escalationPatterns.some((p) => p.test(lastAssistant.content))) {
          return true;
        }
      }
    }

    return false;
  }

  private buildSystemPrompt(): string {
    const { persona, taskIntent, hiddenContext } = this.config;

    const contextLines = Object.entries(hiddenContext)
      .map(
        ([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
      )
      .join("\n");

    return `You are simulating a customer in a conversation with a customer service agent.

## Your Persona
${persona.system_prompt}

## Response Style
- Tone: ${persona.response_style.tone ?? "neutral"}
- Verbosity: ${persona.response_style.verbosity}
- Cooperativeness: ${persona.response_style.cooperativeness}

## Your Intent
${taskIntent}

## Information You Know (use when asked)
${contextLines}

## Instructions
- Stay in character throughout the conversation
- Pursue your intent naturally
- Only reveal hidden context information when asked or when it makes sense
- Respond naturally as a real customer would
- If the agent resolves your issue, express satisfaction and end naturally
- If you need to provide verification info, do so according to your cooperativeness level
- Keep responses concise and realistic
- Do NOT break character or mention you are a simulation`;
  }
}
