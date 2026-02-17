import type { EvalMcpClient } from "../clients/mcp-client.js";
import type { VerifierRule } from "../config/schemas.js";
import type {
  ConversationMessage,
  ToolCall,
  VerifierCheckResult,
  VerifierContext,
} from "../types.js";
import type { Verifier } from "./index.js";

interface ToolSemantic {
  type: "query" | "mutation" | "lookup";
  description?: string;
  requires_confirmation?: boolean;
}

export class RuleEngine implements Verifier {
  private rules: VerifierRule[];
  private toolSemantics: Record<string, ToolSemantic>;
  private mcpClient: EvalMcpClient;

  constructor(
    rules: VerifierRule[],
    toolSemantics: Record<string, ToolSemantic>,
    mcpClient: EvalMcpClient,
  ) {
    this.rules = rules;
    this.toolSemantics = toolSemantics;
    this.mcpClient = mcpClient;
  }

  async check(context: VerifierContext): Promise<VerifierCheckResult[]> {
    const results: VerifierCheckResult[] = [];

    for (const rule of this.rules) {
      if (!this.matchesTrigger(rule, context)) continue;

      const conditionMet = await this.evaluateCondition(rule, context);

      if (conditionMet) {
        // Condition met = rule passes (no violation)
        results.push({
          ruleId: rule.id,
          passed: true,
          action: "approve",
          severity: rule.severity,
        });
      } else {
        // Condition NOT met = rule violation
        results.push({
          ruleId: rule.id,
          passed: false,
          action: rule.on_fail.action,
          message: rule.on_fail.message,
          severity: rule.severity,
        });
      }
    }

    return results;
  }

  private matchesTrigger(
    rule: VerifierRule,
    context: VerifierContext,
  ): boolean {
    const trigger = rule.trigger;

    // Match specific tool
    if (trigger.tool && context.toolCall) {
      if (context.toolCall.name !== trigger.tool) return false;
    } else if (trigger.tool && !context.toolCall) {
      return false;
    }

    // Match tool type via semantics
    if (trigger.tool_type && context.toolCall) {
      const semantic = this.toolSemantics[context.toolCall.name];
      if (!semantic || semantic.type !== trigger.tool_type) return false;
    } else if (trigger.tool_type && !context.toolCall) {
      return false;
    }

    // Match event type
    if (trigger.type === "agent_message") {
      if (!context.agentMessage) return false;
    } else if (trigger.type === "tool_call") {
      if (!context.toolCall) return false;
    }

    // Match params constraints
    if (trigger.params && context.toolCall) {
      for (const [param, constraint] of Object.entries(trigger.params)) {
        const value = context.toolCall.arguments[param];
        if (value === undefined) continue;
        const numVal = Number(value);
        if (constraint.gt !== undefined && numVal <= constraint.gt)
          return false;
        if (constraint.lt !== undefined && numVal >= constraint.lt)
          return false;
        if (constraint.in && !constraint.in.includes(String(value)))
          return false;
        if (constraint.not_in?.includes(String(value))) return false;
      }
    }

    return true;
  }

  private async evaluateCondition(
    rule: VerifierRule,
    context: VerifierContext,
  ): Promise<boolean> {
    const condition = rule.condition;

    // conversation_must_contain
    if (condition.conversation_must_contain) {
      for (const req of condition.conversation_must_contain) {
        const matched = this.searchHistory(
          context.conversationHistory,
          req.pattern,
          req.from,
          req.within_last_n_turns ?? condition.within_last_n_turns,
        );
        if (!matched) return false;
      }
    }

    // conversation_must_not_contain
    if (condition.conversation_must_not_contain) {
      for (const req of condition.conversation_must_not_contain) {
        const matched = this.searchHistory(
          context.conversationHistory,
          req.pattern,
          req.from,
        );
        if (matched) return false;
      }
    }

    // message_must_not_contain
    if (condition.message_must_not_contain && context.agentMessage) {
      for (const req of condition.message_must_not_contain) {
        const regex = new RegExp(req.pattern, "i");
        if (regex.test(context.agentMessage)) return false;
      }
    }

    // params_grounded_in_conversation
    if (condition.params_grounded_in_conversation && context.toolCall) {
      for (const req of condition.params_grounded_in_conversation) {
        const paramValue = String(context.toolCall.arguments[req.param] ?? "");
        if (!paramValue) return false;

        const found = context.conversationHistory.some(
          (m) =>
            m.role === "user" &&
            m.content.toLowerCase().includes(paramValue.toLowerCase()),
        );
        if (!found) return false;
      }
    }

    // pre_check
    if (condition.pre_check && context.toolCall) {
      const preCheckResult = await this.executePreCheck(
        condition.pre_check,
        context.toolCall,
        context.sessionId,
      );
      if (!preCheckResult) return false;
    }

    return true;
  }

  private searchHistory(
    history: ConversationMessage[],
    pattern: string,
    from?: "user" | "assistant",
    withinLastNTurns?: number,
  ): boolean {
    let messages = history;

    if (from) {
      messages = messages.filter((m) => m.role === from);
    }

    if (withinLastNTurns) {
      // Count turns (a turn = one user message + one assistant response)
      const relevantMessages = history.slice(-(withinLastNTurns * 2));
      messages = relevantMessages.filter((m) => !from || m.role === from);
    }

    const regex = new RegExp(pattern, "i");
    return messages.some((m) => regex.test(m.content));
  }

  private async executePreCheck(
    preCheck: NonNullable<VerifierRule["condition"]["pre_check"]>,
    toolCall: ToolCall,
    sessionId: string,
  ): Promise<boolean> {
    // Build params for the lookup tool
    const lookupParams: Record<string, unknown> = { session_id: sessionId };
    for (const [lookupParam, sourceParam] of Object.entries(
      preCheck.params_from,
    )) {
      lookupParams[lookupParam] = toolCall.arguments[sourceParam];
    }

    try {
      const result = await this.mcpClient.callTool(preCheck.tool, lookupParams);

      if (!result.success || !result.data) return false;

      const data = result.data as Record<string, unknown>;

      // Check expectations against returned data
      for (const [field, expected] of Object.entries(preCheck.expect)) {
        const actual = data[field];

        if (typeof expected === "object" && expected !== null) {
          if (expected.in && !expected.in.includes(String(actual)))
            return false;
          if (expected.not_in?.includes(String(actual))) return false;
          if (expected.gt !== undefined && Number(actual) <= expected.gt)
            return false;
          if (expected.lt !== undefined && Number(actual) >= expected.lt)
            return false;
        } else {
          if (String(actual) !== String(expected)) return false;
        }
      }

      return true;
    } catch {
      // If pre-check fails, block the action (fail closed)
      return false;
    }
  }
}
