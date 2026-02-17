import OpenAI from "openai";
import type {
  ConversationMessage,
  LLMResponse,
  OpenAIFunction,
  TokenUsage,
  ToolCall,
} from "../types.js";

interface LLMClientConfig {
  provider: "openai";
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey: string;
}

type ChatCompletionMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export class LLMClient {
  private openai: OpenAI;
  private config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
    this.openai = new OpenAI({ apiKey: config.apiKey });
  }

  async chat(
    messages: ConversationMessage[],
    tools?: OpenAIFunction[],
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    const openaiMessages = messages.map(toOpenAIMessage);

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model: this.config.model,
        messages: openaiMessages,
        temperature: this.config.temperature,
        max_completion_tokens: this.config.maxTokens,
      };

    if (tools && tools.length > 0) {
      params.tools = tools as OpenAI.Chat.Completions.ChatCompletionTool[];
    }

    const response = await this.openai.chat.completions.create(params);
    const latencyMs = Date.now() - startTime;

    const choice = response.choices[0];
    const responseMessage = choice.message;

    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    const toolCalls: ToolCall[] | undefined = responseMessage.tool_calls?.map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }),
    );

    const message: ConversationMessage = {
      role: "assistant",
      content: responseMessage.content ?? "",
      toolCalls,
      timestamp: new Date().toISOString(),
      latencyMs,
      tokenUsage: usage,
    };

    return {
      message,
      usage,
      finishReason: choice.finish_reason ?? "stop",
      latencyMs,
    };
  }
}

function toOpenAIMessage(msg: ConversationMessage): ChatCompletionMessage {
  if (msg.role === "tool") {
    return {
      role: "tool",
      content: msg.content,
      tool_call_id: msg.toolCallId ?? "",
    };
  }

  if (msg.role === "assistant" && msg.toolCalls?.length) {
    return {
      role: "assistant",
      content: msg.content || null,
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }

  return {
    role: msg.role as "user" | "assistant" | "system",
    content: msg.content,
  };
}
