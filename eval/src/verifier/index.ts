import type { EvalMcpClient } from "../clients/mcp-client.js";
import { loadRules } from "../config/loader.js";
import type { DomainConfig } from "../config/schemas.js";
import type { VerifierCheckResult, VerifierContext } from "../types.js";
import { LLMJudge } from "./llm-judge.js";
import { RuleEngine } from "./rule-engine.js";

export interface Verifier {
  check(context: VerifierContext): Promise<VerifierCheckResult[]>;
}

interface VerifierConfig {
  type: "none" | "rules" | "llm";
  rules_file?: string;
}

class PassthroughVerifier implements Verifier {
  async check(_context: VerifierContext): Promise<VerifierCheckResult[]> {
    return [];
  }
}

export function createVerifier(
  config: VerifierConfig,
  domain: DomainConfig,
  mcpClient: EvalMcpClient,
): Verifier {
  switch (config.type) {
    case "none":
      return new PassthroughVerifier();

    case "rules": {
      if (!config.rules_file) {
        throw new Error("rules verifier requires rules_file");
      }
      const rulesConfig = loadRules(config.rules_file);
      return new RuleEngine(
        rulesConfig.rules,
        domain.domain.tool_semantics,
        mcpClient,
      );
    }

    case "llm":
      return new LLMJudge();

    default:
      throw new Error(`Unknown verifier type: ${config.type}`);
  }
}
