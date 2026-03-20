/**
 * compile() — top-level orchestrator for the core pipeline.
 *
 * parse → transform → CompilerIR
 */

import { parse } from "./parse";
import { transform } from "./transform";
import type { CompilerIR, CompilerInput } from "./types";

/**
 * Compile a single SOP + guardrails into a CompilerIR.
 *
 * @throws CompilerError on validation failures
 */
export function compile(input: CompilerInput): CompilerIR {
  const { sop, tools, guardrails } = parse(input);
  return transform(sop, tools, guardrails, input.agentConfig, input.agentSops);
}
