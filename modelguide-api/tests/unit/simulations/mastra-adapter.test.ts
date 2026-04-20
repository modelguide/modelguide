import { describe, expect, test } from "bun:test";
import {
  type MastraGenerationStep,
  extractToolCalls,
} from "@features/simulations/adapters/mastra-adapter";

/**
 * These tests pin the contract that eval LLM-judges rely on: the adapter
 * MUST expose each tool call's real result, not the `{}` it used to stamp
 * on every call before the PR #247 fix.
 */
describe("extractToolCalls", () => {
  test("returns an empty array when there are no steps", () => {
    expect(extractToolCalls([])).toEqual([]);
  });

  test("returns an empty array when a step has no tool calls", () => {
    const steps: MastraGenerationStep[] = [{ toolCalls: [], toolResults: [] }];
    expect(extractToolCalls(steps)).toEqual([]);
  });

  test("merges a tool call with its matching result by toolCallId", () => {
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          {
            payload: {
              toolCallId: "call_1",
              toolName: "lookup_order",
              args: { orderId: "ORD-42" },
            },
          },
        ],
        toolResults: [
          {
            payload: {
              toolCallId: "call_1",
              result: { status: "shipped", total: 99.5 },
            },
          },
        ],
      },
    ];

    expect(extractToolCalls(steps)).toEqual([
      {
        name: "lookup_order",
        arguments: { orderId: "ORD-42" },
        result: { status: "shipped", total: 99.5 },
      },
    ]);
  });

  test("matches calls and results even when their order differs", () => {
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          { payload: { toolCallId: "call_a", toolName: "first", args: {} } },
          { payload: { toolCallId: "call_b", toolName: "second", args: {} } },
        ],
        toolResults: [
          { payload: { toolCallId: "call_b", result: "RESULT_B" } },
          { payload: { toolCallId: "call_a", result: "RESULT_A" } },
        ],
      },
    ];

    const result = extractToolCalls(steps);
    expect(result[0]).toMatchObject({ name: "first", result: "RESULT_A" });
    expect(result[1]).toMatchObject({ name: "second", result: "RESULT_B" });
  });

  test("flattens tool calls across multiple steps preserving order", () => {
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          { payload: { toolCallId: "c1", toolName: "step1_tool", args: {} } },
        ],
        toolResults: [{ payload: { toolCallId: "c1", result: "r1" } }],
      },
      {
        toolCalls: [
          { payload: { toolCallId: "c2", toolName: "step2_tool", args: {} } },
        ],
        toolResults: [{ payload: { toolCallId: "c2", result: "r2" } }],
      },
    ];

    expect(extractToolCalls(steps).map((c) => c.name)).toEqual([
      "step1_tool",
      "step2_tool",
    ]);
  });

  test("falls back to payload.output when no matching toolResults entry exists", () => {
    // Some Mastra SDK versions populate the result on the calls side instead
    // of emitting a parallel toolResults entry. Fall back to that so we don't
    // regress on older SDKs.
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          {
            payload: {
              toolCallId: "call_1",
              toolName: "inline_tool",
              args: { q: "x" },
              output: { legacy: true },
            },
          },
        ],
        toolResults: [],
      },
    ];

    expect(extractToolCalls(steps)[0].result).toEqual({ legacy: true });
  });

  test("prefers toolResults.result over the calls-side output field", () => {
    // When both are present, the results-side value is authoritative — the
    // calls-side `output` field is stale or undefined in current SDK versions.
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          {
            payload: {
              toolCallId: "call_1",
              toolName: "tool",
              args: {},
              output: { stale: true },
            },
          },
        ],
        toolResults: [
          { payload: { toolCallId: "call_1", result: { fresh: true } } },
        ],
      },
    ];

    expect(extractToolCalls(steps)[0].result).toEqual({ fresh: true });
  });

  test("leaves result undefined when neither side has it", () => {
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          { payload: { toolCallId: "call_1", toolName: "tool", args: {} } },
        ],
        toolResults: [],
      },
    ];

    expect(extractToolCalls(steps)[0].result).toBeUndefined();
  });

  test("defaults missing args to an empty object", () => {
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [{ payload: { toolCallId: "call_1", toolName: "tool" } }],
        toolResults: [{ payload: { toolCallId: "call_1", result: "ok" } }],
      },
    ];

    expect(extractToolCalls(steps)[0].arguments).toEqual({});
  });

  test("handles tool calls without a toolCallId by using the calls-side output", () => {
    const steps: MastraGenerationStep[] = [
      {
        toolCalls: [
          {
            payload: {
              toolName: "anonymous_tool",
              args: {},
              output: "inline_result",
            },
          },
        ],
        toolResults: [
          // Unrelated result that should NOT be matched to the id-less call.
          { payload: { toolCallId: "other", result: "other_result" } },
        ],
      },
    ];

    expect(extractToolCalls(steps)[0].result).toBe("inline_result");
  });
});
