export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: string;
  latencyMs?: number;
  tokenUsage?: TokenUsage;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ConversationResult {
  sessionId: string;
  taskId: string;
  configName: string;
  trialNumber: number;
  messages: ConversationMessage[];
  turnCount: number;
  toolCallLog: ToolCallLogEntry[];
  verifierLog: VerifierLogEntry[];
  status: "completed" | "abandoned" | "error";
  error?: string;
  startedAt: string;
  endedAt: string;
  tokenUsage: TokenUsage;
}

export interface ToolCallLogEntry {
  turn: number;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  approved: boolean;
  verifierAction?: string;
  verifierMessage?: string;
  latencyMs: number;
}

export interface VerifierLogEntry {
  turn: number;
  ruleId: string;
  toolName?: string;
  passed: boolean;
  action?: string;
  message?: string;
}

export interface VerifierCheckResult {
  ruleId: string;
  passed: boolean;
  action: "approve" | "reject" | "escalate" | "redact" | "rewrite";
  message?: string;
  severity: "error" | "warning" | "info";
}

export interface VerifierContext {
  toolCall?: ToolCall;
  agentMessage?: string;
  conversationHistory: ConversationMessage[];
  turn: number;
  sessionId: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface LLMResponse {
  message: ConversationMessage;
  usage: TokenUsage;
  finishReason: string;
  latencyMs: number;
}

export interface OpenAIFunction {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface TaskEvaluation {
  taskId: string;
  configName: string;
  trialNumber: number;
  passed: boolean;
  checks: EvalCheck[];
  metrics: Record<string, number>;
}

export interface EvalCheck {
  type:
    | "action_sequence"
    | "must"
    | "must_not"
    | "outcome"
    | "verifier_trigger";
  description: string;
  passed: boolean;
  details?: string;
}

export interface ExperimentResults {
  experimentName: string;
  startedAt: string;
  endedAt: string;
  configs: Record<string, ConfigResults>;
  verifierDelta: Record<string, number>;
}

export interface ConfigResults {
  configName: string;
  tasks: Record<string, TaskResults>;
  aggregateMetrics: Record<string, number>;
}

export interface TaskResults {
  taskId: string;
  trials: ConversationResult[];
  evaluations: TaskEvaluation[];
}
