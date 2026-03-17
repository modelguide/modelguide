/**
 * ModelGuide SOP-to-Agent Compiler
 *
 * Two-layer pipeline:
 *  1. Core (platform-agnostic): SOP + guardrails → CompilerIR
 *  2. Emitter (platform-specific): CompilerIR → Mastra runtime objects
 */

export { compile } from "./core/compile";
export { toMastra } from "./emitters/mastra/index";
export type {
  CompilerInput,
  CompilerIR,
  EnrichedSop,
  EnrichedStep,
  ResolvedTool,
  ParsedGuardrail,
} from "./core/types";
