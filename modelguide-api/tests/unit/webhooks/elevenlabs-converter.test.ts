/**
 * Unit tests for ElevenLabs post-call converter — toolStatus mapping.
 */

import { describe, expect, test } from "bun:test";
import { convertPostCallToSession } from "@features/webhooks/elevenlabs.converter";
import type { PostCallTranscriptionPayload } from "@features/webhooks/elevenlabs.schemas";

type PostCallData = PostCallTranscriptionPayload["data"];

/** Wraps a JSON object string in the ElevenLabs result_value format */
function rv(json: string): string {
  return `[{"type":"text","text":${JSON.stringify(json)}}]`;
}

function makePostCallData(
  transcript: PostCallData["transcript"],
): PostCallData {
  return {
    agent_id: "agent_123",
    status: "done",
    transcript,
    metadata: {
      start_time_unix_secs: 1700000000,
      call_duration_secs: 60,
    },
    analysis: {
      call_successful: "true",
      transcript_summary: "Test call",
    },
  };
}

// ---------------------------------------------------------------------------
// toolStatus mapping
// ---------------------------------------------------------------------------

describe("convertPostCallToSession — toolStatus", () => {
  test("sets toolStatus 'success' for matched tool call with is_error=false", () => {
    const data = makePostCallData([
      {
        role: "agent",
        message: null,
        time_in_call_secs: 5,
        tool_calls: [
          {
            tool_name: "store_get_order",
            request_id: "req_1",
            tool_details: { parameters: { orderId: "123" } },
          },
        ],
        tool_results: [
          {
            request_id: "req_1",
            tool_name: "store_get_order",
            result_value: rv('{"status":"shipped"}'),
            is_error: false,
            tool_latency_secs: 0.5,
          },
        ],
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_1");
    const toolMsg = result.messages.find((m) => m.role === "tool");

    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolStatus).toBe("success");
    expect(toolMsg!.toolName).toBe("store_get_order");
    expect(toolMsg!.toolOutput).toEqual({ status: "shipped" });
  });

  test("sets toolStatus 'error' for matched tool call with is_error=true", () => {
    const data = makePostCallData([
      {
        role: "agent",
        message: null,
        time_in_call_secs: 5,
        tool_calls: [
          {
            tool_name: "store_get_order",
            request_id: "req_2",
            tool_details: { parameters: { orderId: "bad" } },
          },
        ],
        tool_results: [
          {
            request_id: "req_2",
            tool_name: "store_get_order",
            result_value: rv('{"error":"not found"}'),
            is_error: true,
            tool_latency_secs: 0.1,
          },
        ],
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_2");
    const toolMsg = result.messages.find((m) => m.role === "tool");

    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolStatus).toBe("error");
  });

  test("sets toolStatus null when tool call has no matching result", () => {
    const data = makePostCallData([
      {
        role: "agent",
        message: null,
        time_in_call_secs: 5,
        tool_calls: [
          {
            tool_name: "store_list_products",
            request_id: "req_orphan",
            tool_details: { parameters: {} },
          },
        ],
        tool_results: null,
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_3");
    const toolMsg = result.messages.find((m) => m.role === "tool");

    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolStatus).toBeNull();
    expect(toolMsg!.toolOutput).toBeNull();
  });

  test("sets toolStatus null on text-only messages", () => {
    const data = makePostCallData([
      {
        role: "user",
        message: "Hello, where is my order?",
        time_in_call_secs: 0,
        tool_calls: null,
        tool_results: null,
        feedback: null,
        conversation_turn_metrics: null,
      },
      {
        role: "agent",
        message: "Let me look that up for you.",
        time_in_call_secs: 2,
        tool_calls: null,
        tool_results: null,
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_4");

    for (const msg of result.messages) {
      expect(msg.toolStatus).toBeNull();
    }
    expect(result.messages).toHaveLength(2);
  });

  test("handles orphaned tool results with is_error=true", () => {
    const data = makePostCallData([
      {
        role: "agent",
        message: null,
        time_in_call_secs: 10,
        tool_calls: null,
        tool_results: [
          {
            request_id: "req_orphan",
            tool_name: "support_create_ticket",
            result_value: rv('{"error":"timeout"}'),
            is_error: true,
            tool_latency_secs: 30.0,
          },
        ],
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_5");
    const toolMsg = result.messages.find((m) => m.role === "tool");

    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolStatus).toBe("error");
    expect(toolMsg!.toolName).toBe("support_create_ticket");
    expect(toolMsg!.latencyMs).toBe(30000);
  });

  test("handles orphaned tool results with is_error=false (default success)", () => {
    const data = makePostCallData([
      {
        role: "agent",
        message: null,
        time_in_call_secs: 10,
        tool_calls: null,
        tool_results: [
          {
            request_id: "req_orphan2",
            tool_name: "store_list_products",
            result_value: rv('{"products":[]}'),
            tool_latency_secs: 0.2,
          },
        ],
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_6");
    const toolMsg = result.messages.find((m) => m.role === "tool");

    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolStatus).toBe("success");
  });

  test("result across transcript entries matches tool call by request_id", () => {
    // Tool call in entry 0, result in entry 1 — tests cross-message matching
    const data = makePostCallData([
      {
        role: "agent",
        message: "Looking up your order...",
        time_in_call_secs: 5,
        tool_calls: [
          {
            tool_name: "store_get_order",
            request_id: "req_cross",
            tool_details: { parameters: { orderId: "42" } },
          },
        ],
        tool_results: null,
        feedback: null,
        conversation_turn_metrics: null,
      },
      {
        role: "agent",
        message: "Found it!",
        time_in_call_secs: 6,
        tool_calls: null,
        tool_results: [
          {
            request_id: "req_cross",
            tool_name: "store_get_order",
            result_value: rv('{"id":"42","status":"delivered"}'),
            is_error: false,
            tool_latency_secs: 0.8,
          },
        ],
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_7");
    const toolMsg = result.messages.find((m) => m.role === "tool");

    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolStatus).toBe("success");
    expect(toolMsg!.toolOutput).toEqual({ id: "42", status: "delivered" });
    expect(toolMsg!.latencyMs).toBe(800);
  });

  test("mixed conversation with text, successful and errored tool calls", () => {
    const data = makePostCallData([
      {
        role: "user",
        message: "Check my order and create a ticket",
        time_in_call_secs: 0,
        tool_calls: null,
        tool_results: null,
        feedback: null,
        conversation_turn_metrics: null,
      },
      {
        role: "agent",
        message: null,
        time_in_call_secs: 2,
        tool_calls: [
          {
            tool_name: "store_get_order",
            request_id: "req_ok",
            tool_details: { parameters: { orderId: "100" } },
          },
          {
            tool_name: "support_create_ticket",
            request_id: "req_fail",
            tool_details: { parameters: { subject: "Issue" } },
          },
        ],
        tool_results: [
          {
            request_id: "req_ok",
            result_value: rv('{"status":"shipped"}'),
            is_error: false,
            tool_latency_secs: 0.3,
          },
          {
            request_id: "req_fail",
            result_value: rv('{"error":"auth failed"}'),
            is_error: true,
            tool_latency_secs: 5.0,
          },
        ],
        feedback: null,
        conversation_turn_metrics: null,
      },
    ]);

    const result = convertPostCallToSession(data, undefined, "conv_8");
    const toolMessages = result.messages.filter((m) => m.role === "tool");

    expect(toolMessages).toHaveLength(2);

    const orderTool = toolMessages.find(
      (m) => m.toolName === "store_get_order",
    );
    expect(orderTool!.toolStatus).toBe("success");
    expect(orderTool!.latencyMs).toBe(300);

    const ticketTool = toolMessages.find(
      (m) => m.toolName === "support_create_ticket",
    );
    expect(ticketTool!.toolStatus).toBe("error");
    expect(ticketTool!.latencyMs).toBe(5000);
  });
});
