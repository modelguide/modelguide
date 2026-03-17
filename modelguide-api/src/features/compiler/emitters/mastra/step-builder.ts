/**
 * Mastra step builder — maps EnrichedSteps to Mastra workflow steps.
 *
 * Steps share a minimal conversation context (messages + toolResults)
 * rather than typed per-step schemas. The workflow is an execution
 * scaffold (step ordering, branching, guardrail injection), not a
 * typed data pipeline.
 */

import type { Agent } from "@mastra/core/agent";
import type { Mastra } from "@mastra/core/mastra";
import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import type { EnrichedStep } from "../../core/types";

// ============================================================================
// Shared step context schema
// ============================================================================

/**
 * Shared context flowing through all workflow steps.
 * Each step reads context, performs work, returns updated context.
 */
const messageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
});

type Message = z.infer<typeof messageSchema>;

function msg(role: Message["role"], content: string): Message {
  return { role, content };
}

export const stepContextSchema = z.object({
  /** Accumulated message history. */
  messages: z.array(messageSchema),
  /** Tool results keyed by resolvedName. */
  toolResults: z.record(z.unknown()),
  /** Intent classification (set by classify-intent, read by branch condition). */
  intent: z.string().optional(),
});

export type StepContext = z.infer<typeof stepContextSchema>;

// ============================================================================
// Step builders
// ============================================================================

function getAgentOrThrow(mastra: Mastra | undefined, agentId: string): Agent {
  const agent = mastra?.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found in Mastra instance`);
  }
  return agent;
}

/**
 * Build a Mastra step from an EnrichedStep.
 *
 * - LLM steps: invoke agent.generate(scopedPrompt), append to messages
 * - Tool steps: reference tool by resolvedName, store result in toolResults
 */
export function buildStep(enrichedStep: EnrichedStep, agentId: string) {
  if (enrichedStep.type === "llm") {
    return buildLlmStep(enrichedStep, agentId);
  }
  return buildToolStep(enrichedStep, agentId);
}

/**
 * LLM step — invokes the agent with the step's scoped prompt.
 */
function buildLlmStep(step: EnrichedStep, agentId: string) {
  return createStep({
    id: step.id,
    inputSchema: stepContextSchema,
    outputSchema: stepContextSchema,
    execute: async ({ inputData, mastra }) => {
      const agent = getAgentOrThrow(mastra, agentId);

      // Classify-intent step uses structured output for reliable intent extraction
      if (step.id === "classify-intent") {
        const result = await agent.generate(step.scopedPrompt, {
          maxSteps: 3,
          structuredOutput: { schema: intentClassificationSchema },
        });

        return {
          messages: [
            ...inputData.messages,
            msg("assistant", result.text ?? ""),
          ],
          toolResults: inputData.toolResults,
          intent: result.object?.intent ?? "unknown",
        };
      }

      const result = await agent.generate(step.scopedPrompt, {
        maxSteps: 3,
      });

      return {
        messages: [...inputData.messages, msg("assistant", result.text ?? "")],
        toolResults: inputData.toolResults,
        intent: inputData.intent,
      };
    },
  });
}

/**
 * Tool step — calls the tool by resolvedName from the agent's toolset.
 *
 * At runtime, tools are provided via MCP toolsets or direct injection.
 * The step stores the tool result in context for downstream steps.
 */
function buildToolStep(step: EnrichedStep, agentId: string) {
  const resolvedName = step.tool?.resolvedName;
  if (!resolvedName) {
    throw new Error(`Tool step "${step.id}" has no resolvedName`);
  }

  return createStep({
    id: step.id,
    inputSchema: stepContextSchema,
    outputSchema: stepContextSchema,
    execute: async ({ inputData, mastra }) => {
      const agent = getAgentOrThrow(mastra, agentId);

      const result = await agent.generate(step.scopedPrompt, {
        maxSteps: 3,
      });

      // Extract tool results from the agent's steps
      const toolResult = extractToolResult(result, resolvedName);

      return {
        messages: [...inputData.messages, msg("assistant", result.text ?? "")],
        toolResults: {
          ...inputData.toolResults,
          [resolvedName]: toolResult,
        },
        intent: inputData.intent,
      };
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Schema for structured intent classification output.
 * Used with Mastra's structuredOutput to get a typed enum
 * instead of parsing free-text LLM responses.
 */
const intentClassificationSchema = z.object({
  intent: z.enum(["wismo", "out-of-scope", "unknown"]),
});

/**
 * Extract tool result from an agent generation result.
 */
function extractToolResult(
  result: { steps: unknown[] },
  toolName: string,
): unknown {
  // Walk through the agent's steps looking for tool results
  for (const step of result.steps as Array<{
    toolResults?: Array<{ payload?: { toolName: string; result: unknown } }>;
  }>) {
    for (const tr of step.toolResults ?? []) {
      if (tr.payload?.toolName?.includes(toolName)) {
        return tr.payload.result;
      }
    }
  }
  return null;
}
