import { LLMClient } from "./clients/llm-client.js";
import { EvalMcpClient, toOpenAIFunctions } from "./clients/mcp-client.js";
import { EvalRestClient } from "./clients/rest-client.js";
import type {
  DomainConfig,
  ModelsConfig,
  PersonaConfig,
  TaskConfig,
} from "./config/schemas.js";
import type {
  ConversationMessage,
  ConversationResult,
  OpenAIFunction,
  TokenUsage,
  ToolCallLogEntry,
  VerifierLogEntry,
} from "./types.js";
import { UserSimulator } from "./user-simulator.js";
import type { Verifier } from "./verifier/index.js";

interface OrchestratorConfig {
  domain: DomainConfig;
  task: TaskConfig;
  persona: PersonaConfig;
  models: ModelsConfig;
  agentModelName: string;
  userModelName: string;
  verifier: Verifier;
  maxTurns: number;
  timeoutSeconds: number;
  openaiApiKey: string;
  configName: string;
  trialNumber: number;
}

export class Orchestrator {
  private config: OrchestratorConfig;
  private mcpClient: EvalMcpClient;
  private restClient: EvalRestClient;

  constructor(config: OrchestratorConfig) {
    this.config = config;

    const mcp = config.domain.domain.mcp;
    this.mcpClient = new EvalMcpClient({
      baseUrl: mcp.base_url,
      agentId: mcp.agent_id,
      apiKey: mcp.api_key,
    });

    this.restClient = new EvalRestClient({
      baseUrl: mcp.base_url,
      apiKey: mcp.api_key,
    });
  }

  async run(): Promise<ConversationResult> {
    const startedAt = new Date().toISOString();
    const messages: ConversationMessage[] = [];
    const toolCallLog: ToolCallLogEntry[] = [];
    const verifierLog: VerifierLogEntry[] = [];
    const totalUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    let sessionId = "";
    let status: ConversationResult["status"] = "completed";
    let error: string | undefined;
    let turn = 0;

    try {
      // 1. Create session
      const session = await this.restClient.createSession(
        "api",
        `eval-user-${this.config.task.task_id}`,
      );
      sessionId = session.id;

      // 2. Connect MCP + discover tools
      await this.mcpClient.connect();
      const mcpTools = await this.mcpClient.discoverTools();
      const openaiTools = toOpenAIFunctions(mcpTools);

      // 3. Build agent system prompt
      const agentSystemPrompt = this.buildAgentSystemPrompt();
      messages.push({
        role: "system",
        content: agentSystemPrompt,
        timestamp: new Date().toISOString(),
      });

      // 4. Set up LLM clients
      const agentModel = this.config.models.models[this.config.agentModelName];
      if (!agentModel) {
        throw new Error(`Agent model not found: ${this.config.agentModelName}`);
      }

      const userModel = this.config.models.models[this.config.userModelName];
      if (!userModel) {
        throw new Error(`User model not found: ${this.config.userModelName}`);
      }

      const agentLLM = new LLMClient({
        provider: agentModel.provider as "openai",
        model: agentModel.model,
        temperature: agentModel.temperature,
        maxTokens: agentModel.max_tokens,
        apiKey: this.config.openaiApiKey,
      });

      const userLLM = new LLMClient({
        provider: userModel.provider as "openai",
        model: userModel.model,
        temperature: userModel.temperature,
        maxTokens: userModel.max_tokens,
        apiKey: this.config.openaiApiKey,
      });

      const userSim = new UserSimulator({
        persona: this.config.persona,
        taskIntent: this.config.task.user.intent,
        hiddenContext: this.config.task.user.hidden_context,
        llmClient: userLLM,
      });

      // 5. Generate opening user message
      const openingMessage = await userSim.generateMessage([]);
      messages.push({
        role: "user",
        content: openingMessage,
        timestamp: new Date().toISOString(),
      });

      // Record user message in session
      await this.restClient.addMessages(sessionId, [
        { role: "user", content: openingMessage },
      ]);

      // 6. Conversation loop
      const deadline = Date.now() + this.config.timeoutSeconds * 1000;

      while (turn < this.config.maxTurns && Date.now() < deadline) {
        turn++;

        // Agent turn
        const agentResponse = await agentLLM.chat(messages, openaiTools);
        this.addUsage(totalUsage, agentResponse.usage);

        if (
          agentResponse.finishReason === "tool_calls" &&
          agentResponse.message.toolCalls?.length
        ) {
          // Agent wants to call tools
          messages.push(agentResponse.message);

          for (const toolCall of agentResponse.message.toolCalls) {
            const toolResult = await this.handleToolCall(
              toolCall,
              sessionId,
              messages,
              turn,
              openaiTools,
              toolCallLog,
              verifierLog,
            );

            messages.push({
              role: "tool",
              content: JSON.stringify(toolResult),
              toolCallId: toolCall.id,
              timestamp: new Date().toISOString(),
            });
          }

          // Don't increment turn for tool results — agent gets another response
          continue;
        }

        // Agent gave text response
        messages.push(agentResponse.message);

        // Run verifier on agent message
        const msgChecks = await this.config.verifier.check({
          agentMessage: agentResponse.message.content,
          conversationHistory: messages,
          turn,
          sessionId,
        });

        for (const check of msgChecks) {
          verifierLog.push({
            turn,
            ruleId: check.ruleId,
            passed: check.passed,
            action: check.passed ? undefined : check.action,
            message: check.message,
          });
        }

        // Record assistant message in session
        await this.restClient.addMessages(sessionId, [
          { role: "assistant", content: agentResponse.message.content },
        ]);

        // Check for escalation from verifier
        const escalated = msgChecks.some(
          (c) => !c.passed && c.action === "escalate",
        );
        if (escalated) {
          status = "completed";
          break;
        }

        // Check stop conditions
        if (userSim.shouldStop(messages)) {
          break;
        }

        // User turn
        const userMessage = await userSim.generateMessage(messages);
        messages.push({
          role: "user",
          content: userMessage,
          timestamp: new Date().toISOString(),
        });

        await this.restClient.addMessages(sessionId, [
          { role: "user", content: userMessage },
        ]);
      }
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    } finally {
      // Close session and MCP client
      try {
        if (sessionId) {
          await this.restClient.closeSession(sessionId, "completed");
        }
      } catch {
        /* best effort */
      }

      try {
        await this.mcpClient.close();
      } catch {
        /* best effort */
      }
    }

    return {
      sessionId,
      taskId: this.config.task.task_id,
      configName: this.config.configName,
      trialNumber: this.config.trialNumber,
      messages,
      turnCount: turn,
      toolCallLog,
      verifierLog,
      status,
      error,
      startedAt,
      endedAt: new Date().toISOString(),
      tokenUsage: totalUsage,
    };
  }

  private async handleToolCall(
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    sessionId: string,
    messages: ConversationMessage[],
    turn: number,
    _openaiTools: OpenAIFunction[],
    toolCallLog: ToolCallLogEntry[],
    verifierLog: VerifierLogEntry[],
  ): Promise<unknown> {
    const startTime = Date.now();

    // Run verifier on tool call
    const checks = await this.config.verifier.check({
      toolCall,
      conversationHistory: messages,
      turn,
      sessionId,
    });

    for (const check of checks) {
      verifierLog.push({
        turn,
        ruleId: check.ruleId,
        toolName: toolCall.name,
        passed: check.passed,
        action: check.passed ? undefined : check.action,
        message: check.message,
      });
    }

    const rejected = checks.find((c) => !c.passed && c.action === "reject");
    const escalated = checks.find((c) => !c.passed && c.action === "escalate");

    if (rejected || escalated) {
      const failCheck = rejected ?? escalated!;
      const latencyMs = Date.now() - startTime;

      toolCallLog.push({
        turn,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        result: { error: failCheck.message },
        approved: false,
        verifierAction: failCheck.action,
        verifierMessage: failCheck.message,
        latencyMs,
      });

      return {
        success: false,
        error: failCheck.message,
      };
    }

    // Tool approved — execute via MCP with session_id injected
    try {
      const result = await this.mcpClient.callTool(toolCall.name, {
        ...toolCall.arguments,
        session_id: sessionId,
      });

      const latencyMs = Date.now() - startTime;

      toolCallLog.push({
        turn,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        result,
        approved: true,
        latencyMs,
      });

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      toolCallLog.push({
        turn,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        result: { error: errorMsg },
        approved: true,
        latencyMs,
      });

      return { success: false, error: errorMsg };
    }
  }

  private buildAgentSystemPrompt(): string {
    const { domain } = this.config;
    return `${domain.domain.agent_persona}

## Policy
${domain.domain.policy}`;
  }

  private addUsage(total: TokenUsage, usage: TokenUsage): void {
    total.promptTokens += usage.promptTokens;
    total.completionTokens += usage.completionTokens;
    total.totalTokens += usage.totalTokens;
  }
}
