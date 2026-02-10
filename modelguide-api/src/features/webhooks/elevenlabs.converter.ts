/**
 * Converts ElevenLabs post-call payload into ModelGuide session + message shapes.
 *
 * ElevenLabs sends tool_calls and tool_results as SEPARATE transcript entries.
 * We match them by request_id across the full transcript before emitting messages.
 */

import type {
  DynamicVariables,
  PostCallTranscriptionPayload,
} from "./elevenlabs.schemas";

type PostCallData = PostCallTranscriptionPayload["data"];

interface ConvertedSession {
  externalId: string;
  channelType: "voice";
  userIdentifier: string | null;
  status: "completed";
  startedAt: Date;
  endedAt: Date;
  metadata: Record<string, unknown>;
}

interface ConvertedMessage {
  role: "assistant" | "user" | "tool";
  content: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: Record<string, unknown> | null;
  modelUsed: string | null;

  latencyMs: number | null;
  occurredAt: Date;
}

export interface ConvertedPostCall {
  session: ConvertedSession;
  messages: ConvertedMessage[];
}

interface ToolCall {
  type?: string;
  tool_name?: string;
  request_id?: string;
  tool_details?: {
    parameters?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ToolResult {
  request_id?: string;
  tool_name?: string;
  result_value?: string;
  is_error?: boolean;
  tool_latency_secs?: number;
  [key: string]: unknown;
}

interface TurnMetrics {
  metrics?: Record<string, { elapsed_time?: number }>;
  convai_asr_provider?: string | null;
  convai_tts_model?: string | null;
}

/**
 * Parse the result_value string from ElevenLabs into a clean object.
 * ElevenLabs wraps results in a JSON array of {type, text} objects
 * where text is itself a JSON string.
 */
function parseResultValue(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0 && arr[0].text) {
      return JSON.parse(arr[0].text);
    }
    return { raw: arr };
  } catch {
    return { raw };
  }
}

/**
 * Extract the most relevant latency from turn metrics.
 * For agent turns: LLM time-to-first-byte is the primary latency.
 * For user turns: ASR trailing latency.
 */
function extractLatencyMs(role: string, metrics?: TurnMetrics): number | null {
  if (!metrics?.metrics) return null;
  const m = metrics.metrics;

  if (role === "agent") {
    const llmTtfb = m.convai_llm_service_ttfb?.elapsed_time;
    if (llmTtfb) return Math.round(llmTtfb * 1000);
    const ttsTtfb = m.convai_tts_service_ttfb?.elapsed_time;
    if (ttsTtfb) return Math.round(ttsTtfb * 1000);
  }

  if (role === "user") {
    const asrLatency = m.convai_asr_trailing_service_latency?.elapsed_time;
    if (asrLatency) return Math.round(asrLatency * 1000);
  }

  return null;
}

/**
 * Extract LLM usage stats from call-level charging metadata.
 */
function extractLlmUsage(metadata: PostCallData["metadata"]): {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
} {
  const charging = metadata.charging as Record<string, unknown> | undefined;
  const llmUsage = charging?.llm_usage as Record<string, unknown> | undefined;
  const generation = llmUsage?.irreversible_generation as
    | Record<string, unknown>
    | undefined;
  const modelUsage = generation?.model_usage as
    | Record<string, Record<string, { tokens?: number; price?: number }>>
    | undefined;

  if (!modelUsage) {
    return {
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: null,
    };
  }

  const modelName = Object.keys(modelUsage)[0] ?? null;
  const usage = modelName ? modelUsage[modelName] : null;

  const inputTokens =
    (usage?.input?.tokens ?? 0) + (usage?.input_cache_read?.tokens ?? 0);
  const outputTokens = usage?.output_total?.tokens ?? 0;

  return {
    model: modelName,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: metadata.cost ?? null,
  };
}

export function convertPostCallToSession(
  data: PostCallData,
  dynamicVars?: DynamicVariables,
): ConvertedPostCall {
  const startTime = data.metadata.start_time_unix_secs;
  const llmUsage = extractLlmUsage(data.metadata);

  const session: ConvertedSession = {
    externalId: data.conversation_id,
    channelType: "voice",
    userIdentifier: dynamicVars?.mg_user_id ?? null,
    status: "completed",
    startedAt: new Date(startTime * 1000),
    endedAt: new Date((startTime + data.metadata.call_duration_secs) * 1000),
    metadata: {
      call_duration_secs: data.metadata.call_duration_secs,
      transcript_summary: data.analysis.transcript_summary,
      call_summary_title: data.analysis.call_summary_title,
      call_successful: data.analysis.call_successful,
      elevenlabs_agent_id: data.agent_id,
      termination_reason: data.metadata.termination_reason,
      llm_model: llmUsage.model,
      llm_input_tokens: llmUsage.inputTokens,
      llm_output_tokens: llmUsage.outputTokens,
      llm_total_tokens: llmUsage.totalTokens,
      cost_credits: llmUsage.cost,
    },
  };

  // First pass: collect all tool results by request_id across the entire transcript
  const allResults = new Map<
    string,
    { result: ToolResult; occurredAt: Date }
  >();
  for (const msg of data.transcript) {
    const occurredAt = new Date((startTime + msg.time_in_call_secs) * 1000);
    for (const tr of (msg.tool_results ?? []) as ToolResult[]) {
      if (tr.request_id) {
        allResults.set(tr.request_id, { result: tr, occurredAt });
      }
    }
  }

  // Second pass: build messages
  const messages: ConvertedMessage[] = [];

  for (const msg of data.transcript) {
    const occurredAt = new Date((startTime + msg.time_in_call_secs) * 1000);
    const toolCalls = (msg.tool_calls ?? []) as ToolCall[];
    const toolResults = (msg.tool_results ?? []) as ToolResult[];
    const turnMetrics = msg.conversation_turn_metrics as
      | TurnMetrics
      | undefined;

    // Emit text message if there's actual content
    const content = msg.message ?? "";
    if (content.trim()) {
      const role = msg.role === "agent" ? "assistant" : "user";
      messages.push({
        role: role as "assistant" | "user",
        content,
        toolName: null,
        toolInput: null,
        toolOutput: null,
        modelUsed:
          turnMetrics?.convai_tts_model ??
          turnMetrics?.convai_asr_provider ??
          null,

        latencyMs: extractLatencyMs(msg.role, turnMetrics),
        occurredAt,
      });
    }

    // Emit a tool message for each tool call (with matched result)
    for (const tc of toolCalls) {
      const toolName = tc.tool_name ?? "unknown";
      const params = tc.tool_details?.parameters ?? {};
      const matched = tc.request_id ? allResults.get(tc.request_id) : undefined;
      const resultValue = matched
        ? parseResultValue(matched.result.result_value)
        : null;
      const latencyMs = matched?.result.tool_latency_secs
        ? Math.round(matched.result.tool_latency_secs * 1000)
        : null;

      messages.push({
        role: "tool",
        content: "",
        toolName,
        toolInput: params,
        toolOutput: resultValue,
        modelUsed: null,

        latencyMs,
        occurredAt,
      });
    }

    // Emit orphaned tool results (no matching call)
    for (const tr of toolResults) {
      if (tr.request_id) continue; // matched results handled above
      messages.push({
        role: "tool",
        content: "",
        toolName: tr.tool_name ?? "unknown",
        toolInput: null,
        toolOutput: parseResultValue(tr.result_value),
        modelUsed: null,

        latencyMs: tr.tool_latency_secs
          ? Math.round(tr.tool_latency_secs * 1000)
          : null,
        occurredAt,
      });
    }
  }

  return { session, messages };
}
