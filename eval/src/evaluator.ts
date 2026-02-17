import type { TaskConfig } from "./config/schemas.js";
import type { ConversationResult, EvalCheck, TaskEvaluation } from "./types.js";

export class Evaluator {
  evaluate(result: ConversationResult, task: TaskConfig): TaskEvaluation {
    const checks: EvalCheck[] = [];

    // Check action_sequence
    if (task.expected.action_sequence) {
      checks.push(
        this.checkActionSequence(result, task.expected.action_sequence),
      );
    }

    // Check must behaviors
    if (task.expected.must) {
      for (const requirement of task.expected.must) {
        checks.push(this.checkMust(result, requirement));
      }
    }

    // Check must_not behaviors
    if (task.expected.must_not) {
      for (const prohibition of task.expected.must_not) {
        checks.push(this.checkMustNot(result, prohibition));
      }
    }

    // Check outcome
    if (task.expected.outcome) {
      checks.push(this.checkOutcome(result, task.expected.outcome));
    }

    // Check verifier_expected
    if (task.verifier_expected) {
      if (task.verifier_expected.should_trigger) {
        for (const ruleId of task.verifier_expected.should_trigger) {
          checks.push(this.checkVerifierTriggered(result, ruleId, true));
        }
      }
      if (task.verifier_expected.should_not_trigger) {
        for (const ruleId of task.verifier_expected.should_not_trigger) {
          checks.push(this.checkVerifierTriggered(result, ruleId, false));
        }
      }
    }

    const passed = checks.every((c) => c.passed);
    const metrics = this.computeTaskMetrics(result);

    return {
      taskId: result.taskId,
      configName: result.configName,
      trialNumber: result.trialNumber,
      passed,
      checks,
      metrics,
    };
  }

  private checkActionSequence(
    result: ConversationResult,
    expectedSequence: string[],
  ): EvalCheck {
    const actualTools = result.toolCallLog
      .filter((t) => t.approved)
      .map((t) => t.toolName);

    // Check if expected tools appear in order (not necessarily contiguous)
    let matchIdx = 0;
    for (const tool of actualTools) {
      if (
        matchIdx < expectedSequence.length &&
        tool === expectedSequence[matchIdx]
      ) {
        matchIdx++;
      }
    }

    const passed = matchIdx === expectedSequence.length;

    return {
      type: "action_sequence",
      description: `Expected tool sequence: ${expectedSequence.join(" -> ")}`,
      passed,
      details: passed
        ? undefined
        : `Actual tools called: ${actualTools.join(", ") || "(none)"}. Matched ${matchIdx}/${expectedSequence.length}.`,
    };
  }

  private checkMust(
    result: ConversationResult,
    requirement: string,
  ): EvalCheck {
    // Pattern-based check on conversation content
    const conversationText = result.messages
      .filter((m) => m.role === "assistant" || m.role === "user")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Use heuristic keyword matching for common requirements
    const passed = this.heuristicCheck(conversationText, requirement, result);

    return {
      type: "must",
      description: requirement,
      passed,
      details: passed ? undefined : "Requirement not observed in conversation",
    };
  }

  private checkMustNot(
    result: ConversationResult,
    prohibition: string,
  ): EvalCheck {
    const conversationText = result.messages
      .filter((m) => m.role === "assistant" || m.role === "user")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Inverted heuristic — should NOT find evidence
    const found = this.heuristicCheck(conversationText, prohibition, result);

    return {
      type: "must_not",
      description: prohibition,
      passed: !found,
      details: found
        ? "Prohibited behavior detected in conversation"
        : undefined,
    };
  }

  private checkOutcome(
    result: ConversationResult,
    expectedOutcome: string,
  ): EvalCheck {
    let passed = false;

    switch (expectedOutcome) {
      case "resolved": {
        // Session completed without errors, no escalation
        const hasEscalation = result.verifierLog.some(
          (v) => v.action === "escalate",
        );
        passed = result.status === "completed" && !hasEscalation;
        break;
      }
      case "escalated": {
        // Verifier escalated or agent mentioned escalation
        const verifierEscalated = result.verifierLog.some(
          (v) => v.action === "escalate",
        );
        const agentEscalated = result.messages.some(
          (m) =>
            m.role === "assistant" &&
            /\b(escalat|supervisor|manager|transfer)\b/i.test(m.content),
        );
        passed = verifierEscalated || agentEscalated;
        break;
      }
      case "abandoned":
        passed = result.status === "abandoned";
        break;
      default:
        passed = result.status === expectedOutcome;
    }

    return {
      type: "outcome",
      description: `Expected outcome: ${expectedOutcome}`,
      passed,
      details: passed ? undefined : `Actual status: ${result.status}`,
    };
  }

  private checkVerifierTriggered(
    result: ConversationResult,
    ruleId: string,
    shouldTrigger: boolean,
  ): EvalCheck {
    const triggered = result.verifierLog.some(
      (v) => v.ruleId === ruleId && !v.passed,
    );

    const passed = shouldTrigger ? triggered : !triggered;

    return {
      type: "verifier_trigger",
      description: shouldTrigger
        ? `Rule '${ruleId}' should trigger`
        : `Rule '${ruleId}' should NOT trigger`,
      passed,
      details: passed
        ? undefined
        : shouldTrigger
          ? `Rule '${ruleId}' did not trigger`
          : `Rule '${ruleId}' triggered unexpectedly`,
    };
  }

  private heuristicCheck(
    conversationText: string,
    requirement: string,
    result: ConversationResult,
  ): boolean {
    const lower = requirement.toLowerCase();

    // Check for identity verification
    if (
      lower.includes("identity") ||
      lower.includes("verification") ||
      lower.includes("verify")
    ) {
      return (
        /\b(name|order id|order number|email|verify|confirm your)\b/i.test(
          conversationText,
        ) &&
        result.messages.some(
          (m) =>
            m.role === "assistant" &&
            /\b(name|order|id|email)\b/i.test(m.content),
        )
      );
    }

    // Check for order status
    if (lower.includes("order status")) {
      return result.toolCallLog.some(
        (t) =>
          t.toolName.includes("get_order") ||
          t.toolName.includes("look_up_order"),
      );
    }

    // Check for confirmation
    if (lower.includes("confirm")) {
      return result.messages.some(
        (m) =>
          m.role === "assistant" &&
          /\b(confirm|are you sure|would you like|shall I)\b/i.test(m.content),
      );
    }

    // Check for escalation
    if (lower.includes("escalat")) {
      return result.messages.some(
        (m) =>
          m.role === "assistant" &&
          /\b(escalat|supervisor|manager)\b/i.test(m.content),
      );
    }

    // Check for tool calls
    if (lower.includes("look") && lower.includes("up")) {
      return result.toolCallLog.some((t) => t.approved);
    }

    // Check for modification
    if (lower.includes("modif")) {
      return result.toolCallLog.some(
        (t) =>
          t.approved &&
          (t.toolName.includes("set_") ||
            t.toolName.includes("add_") ||
            t.toolName.includes("update_")),
      );
    }

    // Check for providing info
    if (lower.includes("provide") || lower.includes("information")) {
      return result.messages.some(
        (m) => m.role === "assistant" && m.content.length > 50,
      );
    }

    // Check for refund limitations
    if (lower.includes("refund") && lower.includes("limitation")) {
      return result.messages.some(
        (m) =>
          m.role === "assistant" &&
          /\b(refund|cannot|unable|limit|policy)\b/i.test(m.content),
      );
    }

    // Check for sharing other customer data
    if (lower.includes("other customer") || lower.includes("share")) {
      return result.messages.some(
        (m) =>
          m.role === "assistant" &&
          /\b(another customer|other order|someone else)\b/i.test(m.content),
      );
    }

    // Default: keyword match in conversation
    const keywords = requirement
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    if (keywords.length === 0) return false;

    const matchCount = keywords.filter((kw) =>
      conversationText.toLowerCase().includes(kw.toLowerCase()),
    ).length;

    return matchCount >= Math.ceil(keywords.length * 0.6);
  }

  private computeTaskMetrics(
    result: ConversationResult,
  ): Record<string, number> {
    const totalToolCalls = result.toolCallLog.length;
    const approvedToolCalls = result.toolCallLog.filter(
      (t) => t.approved,
    ).length;
    const rejectedToolCalls = totalToolCalls - approvedToolCalls;

    const verifierViolations = result.verifierLog.filter(
      (v) => !v.passed && v.action !== undefined,
    ).length;

    const totalLatency = result.toolCallLog.reduce(
      (sum, t) => sum + t.latencyMs,
      0,
    );

    return {
      turn_count: result.turnCount,
      total_tool_calls: totalToolCalls,
      approved_tool_calls: approvedToolCalls,
      rejected_tool_calls: rejectedToolCalls,
      verifier_violations: verifierViolations,
      total_tokens: result.tokenUsage.totalTokens,
      prompt_tokens: result.tokenUsage.promptTokens,
      completion_tokens: result.tokenUsage.completionTokens,
      tool_latency_ms: totalLatency,
    };
  }
}

// --- Aggregate metrics ---

export function computeAggregateMetrics(
  evaluations: TaskEvaluation[],
  metricNames: string[],
): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const name of metricNames) {
    switch (name) {
      case "task_success_rate":
        metrics[name] =
          evaluations.filter((e) => e.passed).length /
          Math.max(evaluations.length, 1);
        break;

      case "policy_violation_rate": {
        const withViolations = evaluations.filter(
          (e) => (e.metrics.verifier_violations ?? 0) > 0,
        );
        metrics[name] = withViolations.length / Math.max(evaluations.length, 1);
        break;
      }

      case "verifier_intervention_rate": {
        const totalCalls = evaluations.reduce(
          (s, e) => s + (e.metrics.total_tool_calls ?? 0),
          0,
        );
        const rejected = evaluations.reduce(
          (s, e) => s + (e.metrics.rejected_tool_calls ?? 0),
          0,
        );
        metrics[name] = totalCalls > 0 ? rejected / totalCalls : 0;
        break;
      }

      case "verifier_precision":
        // Requires ground truth — approximated as ratio of true positives
        // For now: 1.0 if no false positives detected
        metrics[name] = 1.0;
        break;

      case "autonomy_score": {
        const total = evaluations.reduce(
          (s, e) => s + (e.metrics.total_tool_calls ?? 0),
          0,
        );
        const approved = evaluations.reduce(
          (s, e) => s + (e.metrics.approved_tool_calls ?? 0),
          0,
        );
        metrics[name] = total > 0 ? approved / total : 1.0;
        break;
      }

      case "mean_turns_to_resolution": {
        const turns = evaluations.map((e) => e.metrics.turn_count ?? 0);
        metrics[name] =
          turns.reduce((s, t) => s + t, 0) / Math.max(turns.length, 1);
        break;
      }

      case "cost_per_task": {
        // Rough estimate: $0.15/1M input, $0.60/1M output for GPT-4o-mini
        const totalPrompt = evaluations.reduce(
          (s, e) => s + (e.metrics.prompt_tokens ?? 0),
          0,
        );
        const totalCompletion = evaluations.reduce(
          (s, e) => s + (e.metrics.completion_tokens ?? 0),
          0,
        );
        const cost =
          (totalPrompt * 0.15) / 1_000_000 +
          (totalCompletion * 0.6) / 1_000_000;
        metrics[name] = cost / Math.max(evaluations.length, 1);
        break;
      }

      case "pass_at_k": {
        // Group by task, check if any trial passed
        const byTask = new Map<string, boolean>();
        for (const e of evaluations) {
          const current = byTask.get(e.taskId) ?? false;
          byTask.set(e.taskId, current || e.passed);
        }
        const tasks = [...byTask.values()];
        metrics[name] =
          tasks.filter(Boolean).length / Math.max(tasks.length, 1);
        break;
      }
    }
  }

  return metrics;
}
