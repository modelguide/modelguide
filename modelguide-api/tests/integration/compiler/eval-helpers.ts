/**
 * Shared helpers for compiler E2E tests.
 *
 * Keeps test files focused on Given/When/Then intent
 * by extracting compile-run-store-eval plumbing.
 */

import { expect } from "bun:test";
import { forOrg } from "@db/rls";
import { evalRunScores, evalRuns, sessionMessages } from "@db/schema";
import { compile } from "@features/compiler/core/compile";
import { toMastra } from "@features/compiler/emitters/mastra";
import { compileSopToEvalPlan } from "@features/evals/evals.compile";
import { executeAssertions } from "@features/evals/evals.service";
import type { ResolvedAssertion } from "@features/evals/evals.types";
import { storeSyntheticSession } from "@features/sessions/synthetic-session.service";
import { getLogger } from "@lib/logger";
import { asc, eq } from "drizzle-orm";
import { emailOrderNotArrivedSop } from "../../fixtures/compiler/email-wismo-sop";
import { createMockedToolsets } from "../../fixtures/compiler/mocked-tools";
import { sampleGuardrails } from "../../fixtures/compiler/sample-guardrails";
import { testEmails, toPrompt } from "../../fixtures/compiler/test-emails";

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
  model: "anthropic/claude-haiku-4-5-20251001",
  description:
    "You are a customer support agent for an e-commerce store handling inbound support emails. You process one email per run and send a single reply.",
  promptConfig: {},
  modelFamily: "generic" as const,
  modality: "text" as const,
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

/**
 * Store agent generation result as a completed session.
 *
 * Delegates to storeSyntheticSession production service.
 */
export async function storeSession(
  ctx: E2EContext,
  prompt: string,
  // biome-ignore lint/suspicious/noExplicitAny: Mastra generation result is loosely typed
  result: { steps: any[]; text?: string | null },
  userIdentifier: string,
) {
  return storeSyntheticSession({
    orgId: ctx.orgId,
    agentId: ctx.agentId,
    generationResult: result,
    userInput: prompt,
    channelType: "email",
    userIdentifier,
  });
}

/** SOP step definitions shared across happy/unhappy path tests. */
export function buildSopSteps(
  ctx: E2EContext,
  evals: {
    lookupEvalId: string;
    escalationEvalId: string;
    replyJudgeEvalId?: string;
  },
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
      ...(evals.replyJudgeEvalId && {
        evalConfigId: evals.replyJudgeEvalId,
      }),
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

/** Compile SOP into assertions, run evaluators, persist, and assert all pass. */
export async function runEvalAndAssertAllPass(
  ctx: E2EContext,
  sessionId: string,
  sopId: string,
) {
  // 1. Compile SOP to eval plan
  const plan = await compileSopToEvalPlan(ctx.orgId, sopId, sessionId);
  const assertions: ResolvedAssertion[] = plan.steps
    .filter((step) => step.evaluator !== null)
    .map((step) => ({
      order: step.order,
      name: `step:${step.order}:${step.instruction.slice(0, 60)}`,
      required: step.required,
      evaluator: step.evaluator!,
      toolNameMap: step.toolNameMap,
    }));

  // 2. Create eval run + load messages + execute assertions
  const evalResult = await forOrg(ctx.orgId, async (tx) => {
    const [evalRun] = await tx
      .insert(evalRuns)
      .values({
        organizationId: ctx.orgId,
        sessionId,
        sourceType: "suite" as const,
        sourceId: sopId,
        status: "running",
      })
      .returning();

    const messages = await tx
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.occurredAt), asc(sessionMessages.createdAt));

    const { scoreRows } = await executeAssertions(
      assertions,
      messages,
      evalRun.id,
      ctx.orgId,
    );

    const failedRequired = scoreRows.filter(
      (s) => s.required && (s.result === "fail" || s.result === "error"),
    );
    const passed = failedRequired.length === 0;

    if (scoreRows.length > 0) {
      await tx.insert(evalRunScores).values(scoreRows);
    }

    const [completedRun] = await tx
      .update(evalRuns)
      .set({ status: "completed", passed, completedAt: new Date() })
      .where(eq(evalRuns.id, evalRun.id))
      .returning();

    const scores = await tx
      .select()
      .from(evalRunScores)
      .where(eq(evalRunScores.evalRunId, evalRun.id))
      .orderBy(asc(evalRunScores.scoreOrder));

    return { ...completedRun, scores };
  });

  log.info(
    {
      runId: evalResult.id,
      status: evalResult.status,
      passed: evalResult.passed,
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
    // "skip" is acceptable only when the LLM judge key is not configured;
    // "error" always fails — a misconfigured key should not pass silently.
    expect(
      score.result,
      `${score.name} (${score.evaluatorType}): ${score.reasoning}`,
    ).not.toBe("error");
    expect(
      score.result,
      `${score.name} (${score.evaluatorType}): ${score.reasoning}`,
    ).not.toBe("fail");
  }

  return evalResult;
}
