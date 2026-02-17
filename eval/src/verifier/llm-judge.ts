import type { VerifierCheckResult, VerifierContext } from "../types.js";
import type { Verifier } from "./index.js";

/**
 * LLM-as-verifier stub for future implementation.
 * Will use an LLM to evaluate tool calls and agent messages
 * against policy rules expressed in natural language.
 */
export class LLMJudge implements Verifier {
  async check(_context: VerifierContext): Promise<VerifierCheckResult[]> {
    throw new Error(
      "LLMJudge is not yet implemented. Use 'rules' verifier type instead.",
    );
  }
}
