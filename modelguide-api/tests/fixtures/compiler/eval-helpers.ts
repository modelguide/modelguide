/**
 * Shared helpers for compiler E2E tests.
 *
 * Keeps test files focused on Given/When/Then intent
 * by extracting compile-run-store-eval plumbing.
 */

import { expect } from "bun:test";
import { compile } from "@features/compiler/core/compile";
import { toMastra } from "@features/compiler/emitters/mastra/index";
import { runEvaluation } from "@features/evals/evals.service";
import {
  addMessage,
  createSession,
  updateSession,
} from "@features/sessions/sessions.service";
import { getLogger } from "@lib/logger";
import { emailOrderNotArrivedSop } from "./email-wismo-sop";
import { createMockedToolsets } from "./mocked-tools";
import { sampleGuardrails } from "./sample-guardrails";
import { testEmails, toPrompt } from "./test-emails";

const log = getLogger().child({ test: "compiler-eval-e2e" }, { level: "info" });

export interface E2EContext {
  orgId: string;
  agentId: string;
  lookUpOrderToolId: string;
  createTicketToolId: string;
}

export const agentConfig = {
  id: "compiler-e2e-agent",
  name: "Compiler E2E Agent",
  model: "openai/gpt-4o-mini",
  description:
    "You are a customer support agent for an e-commerce store handling inbound support emails. You process one email per run and send a single reply.",
};

/** Compile the fixture SOP and run the agent against a test email. */
export async function compileAndRun(emailIndex: number) {
  const ir = compile({
    sops: [emailOrderNotArrivedSop],
    guardrails: sampleGuardrails,
    agentConfig,
  });
  const { agent } = toMastra(ir);
  const prompt = toPrompt(testEmails[emailIndex].input);

  const result = await agent.generate(prompt, {
    toolsets: createMockedToolsets(),
    maxSteps: 5,
  });

  return { ir, prompt, result };
}

/** Store agent generation result as a completed session. */
export async function storeSession(
  ctx: E2EContext,
  prompt: string,
  // biome-ignore lint/suspicious/noExplicitAny: Mastra generation result is loosely typed
  result: { steps: any[]; text?: string | null },
  userIdentifier: string,
) {
  const session = await createSession(ctx.orgId, ctx.agentId, {
    channelType: "email",
    userIdentifier,
  });

  await addMessage(ctx.orgId, session.id, ctx.agentId, {
    role: "user",
    content: prompt,
  });

  // biome-ignore lint/suspicious/noExplicitAny: Mastra step types are loosely typed
  for (const step of result.steps as any[]) {
    const toolCalls =
      step.toolCalls?.map(
        (tc: {
          payload?: { toolName?: string };
          toolName?: string;
          toolCallId?: string;
          args?: Record<string, unknown>;
          result?: unknown;
        }) => ({
          toolCallId: tc.toolCallId ?? crypto.randomUUID(),
          toolName: tc.payload?.toolName ?? tc.toolName ?? "unknown",
          toolInput: tc.args ?? {},
          toolOutput:
            typeof tc.result === "object" && tc.result !== null
              ? (tc.result as Record<string, unknown>)
              : { result: tc.result },
          toolStatus: "success" as const,
        }),
      ) ?? [];

    if (step.text || toolCalls.length > 0) {
      await addMessage(ctx.orgId, session.id, ctx.agentId, {
        role: "assistant",
        content: step.text ?? undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }
  }

  await updateSession(ctx.orgId, session.id, ctx.agentId, {
    status: "completed",
  });

  return session;
}

/** SOP step definitions shared across happy/unhappy path tests. */
export function buildSopSteps(
  ctx: E2EContext,
  evals: { lookupEvalId: string; escalationEvalId: string },
) {
  return [
    {
      id: "classify-intent",
      order: 1,
      instruction: "Classify the email intent.",
      required: true,
    },
    {
      id: "lookup-order",
      order: 2,
      instruction: "Look up order using extracted order number.",
      required: true,
      tool: { connectorToolId: ctx.lookUpOrderToolId },
      evalConfigId: evals.lookupEvalId,
    },
    {
      id: "compose-reply",
      order: 3,
      instruction: "Compose reply based on order lookup result.",
      required: true,
    },
    {
      id: "escalate-if-needed",
      order: 4,
      instruction: "Escalate if out of scope by creating a helpdesk ticket.",
      required: false,
      tool: { connectorToolId: ctx.createTicketToolId },
      evalConfigId: evals.escalationEvalId,
    },
  ];
}

/** Run eval, log results, and assert all scores pass. */
export async function runEvalAndAssertAllPass(
  ctx: E2EContext,
  sessionId: string,
  sopId: string,
) {
  const evalResult = await runEvaluation(ctx.orgId, sessionId, "sop", sopId);

  log.info(
    {
      runId: evalResult.id,
      status: evalResult.status,
      passed: evalResult.passed,
      durationMs: evalResult.durationMs,
      scores: evalResult.scores.map((s) => ({
        result: s.result,
        evaluatorType: s.evaluatorType,
        name: s.name,
        reasoning: s.reasoning,
      })),
    },
    "eval run completed",
  );

  expect(evalResult.status).toBe("completed");
  expect(evalResult.passed).toBe(true);

  for (const score of evalResult.scores) {
    expect(score.result).toBe("pass");
  }

  return evalResult;
}
