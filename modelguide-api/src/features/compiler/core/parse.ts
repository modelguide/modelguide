/**
 * Parse stage — validates SOP definitions and guardrails.
 *
 * Zero framework imports. Uses Zod schemas from modelguide-api
 * for validation (they're just data — no Hono, no Mastra).
 */

import { guardrailConfigSchema } from "@features/knowledge-base/knowledge-base.schemas";
import { sopDefinitionSchema } from "@features/sops/sops.schemas";
import type {
  CompilerInput,
  KnowledgeBaseDetailResponse,
  ParsedGuardrail,
  ResolvedTool,
  SopDetailResponse,
} from "./types";

export class CompilerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CompilerError";
  }
}

// ============================================================================
// SOP validation
// ============================================================================

/**
 * Validate exactly one SOP is provided, validate its definition,
 * and collect unique tool references.
 */
export function parseSop(sops: SopDetailResponse[]): {
  sop: SopDetailResponse;
  tools: ResolvedTool[];
} {
  // Phase 1: exactly one SOP
  if (sops.length !== 1) {
    throw new CompilerError(
      `Phase 1 compiler requires exactly one SOP, received ${sops.length}`,
      "INVALID_SOP_COUNT",
    );
  }

  const sop = sops[0];
  const definition = sop.definition;

  // Validate definition against Zod schema (catches invalid schemaVersion, etc.)
  const result = sopDefinitionSchema.safeParse(definition);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new CompilerError(
      `Invalid SOP definition: ${issues}`,
      "INVALID_SOP_DEFINITION",
    );
  }

  // Validate tool references: steps with a tool must have resolvedName
  const tools: ResolvedTool[] = [];
  const seenTools = new Set<string>();

  for (const step of definition.steps) {
    if (step.tool) {
      if (!step.tool.resolvedName) {
        throw new CompilerError(
          `Step "${step.id}" has a tool reference but no resolvedName`,
          "MISSING_RESOLVED_NAME",
        );
      }

      if (!seenTools.has(step.tool.resolvedName)) {
        seenTools.add(step.tool.resolvedName);
        tools.push({
          resolvedName: step.tool.resolvedName,
          connectorToolId: step.tool.connectorToolId,
          connectorId: step.tool.connectorId,
        });
      }
    }
  }

  return { sop, tools };
}

// ============================================================================
// Guardrail validation
// ============================================================================

/**
 * Validate guardrail configs and narrow from `Record<string, unknown>`
 * to typed `GuardrailConfig`.
 */
export function parseGuardrails(
  guardrails: KnowledgeBaseDetailResponse[],
): ParsedGuardrail[] {
  return guardrails.map((kb) => {
    const configResult = guardrailConfigSchema.safeParse(kb.config);
    if (!configResult.success) {
      const issues = configResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new CompilerError(
        `Invalid guardrail config for "${kb.name}": ${issues}`,
        "INVALID_GUARDRAIL_CONFIG",
      );
    }

    return {
      id: kb.id,
      name: kb.name,
      description: kb.description,
      content: kb.content,
      config: configResult.data,
    };
  });
}

/**
 * Run the full parse stage.
 */
export function parse(input: CompilerInput) {
  const { sop, tools } = parseSop(input.sops);
  const guardrails = parseGuardrails(input.guardrails);
  return { sop, tools, guardrails };
}
