/**
 * Mastra workflow builder — chains enriched steps into workflows
 * with conditional branching.
 *
 * Topology for the email WISMO SOP:
 *   classify-intent → .branch([
 *     [intent === "wismo", wismoPath (extract → lookup → compose)],
 *     [intent === "out-of-scope", escalate-if-needed],
 *   ])
 */

import { createWorkflow } from "@mastra/core/workflows";
import type { EnrichedStep } from "../../core/types";
import { buildStep, stepContextSchema } from "./step-builder";

// biome-ignore lint/suspicious/noExplicitAny: Mastra workflow types are complex
type AnyWorkflow = any;

/**
 * Build workflows from enriched SOP steps.
 *
 * Returns a Record keyed by SOP slug containing the workflow.
 * Phase 1 supports a single SOP with branch routing based on
 * the classify-intent step's output.
 */
export function buildWorkflows(
  slug: string,
  enrichedSteps: EnrichedStep[],
  agentId: string,
): Record<string, AnyWorkflow> {
  const steps = enrichedSteps.map((es) => buildStep(es, agentId));

  // Find the classify-intent step (first step, determines branch routing)
  const classifyStep = steps[0];
  if (!classifyStep) {
    throw new Error("SOP must have at least one step");
  }

  if (steps.length === 1) {
    // Single step — no branching needed
    const workflow = createWorkflow({
      id: slug,
      inputSchema: stepContextSchema,
      outputSchema: stepContextSchema,
    })
      .then(classifyStep)
      .commit();

    return { [slug]: workflow };
  }

  // Find the escalation step (last step with tool reference to create_ticket)
  const escalateStepIndex = enrichedSteps.findIndex(
    (es) =>
      es.tool?.resolvedName?.includes("create_ticket") ||
      es.id.includes("escalat"),
  );

  // Determine WISMO path steps (everything between classify and escalate)
  const wismoStepIndices: number[] = [];
  for (let i = 1; i < enrichedSteps.length; i++) {
    if (i !== escalateStepIndex) {
      wismoStepIndices.push(i);
    }
  }

  if (escalateStepIndex === -1 || wismoStepIndices.length === 0) {
    // No branching topology detected — chain linearly
    let workflow: AnyWorkflow = createWorkflow({
      id: slug,
      inputSchema: stepContextSchema,
      outputSchema: stepContextSchema,
    }).then(classifyStep);

    for (let i = 1; i < steps.length; i++) {
      workflow = workflow.then(steps[i]);
    }

    workflow.commit();
    return { [slug]: workflow };
  }

  // Build the WISMO sub-path as a nested workflow
  let wismoPath: AnyWorkflow = createWorkflow({
    id: `${slug}-wismo-path`,
    inputSchema: stepContextSchema,
    outputSchema: stepContextSchema,
  }).then(steps[wismoStepIndices[0]]);

  for (let i = 1; i < wismoStepIndices.length; i++) {
    wismoPath = wismoPath.then(steps[wismoStepIndices[i]]);
  }
  wismoPath.commit();

  const escalateStep = steps[escalateStepIndex];

  // Build the main workflow with branching
  const workflow = createWorkflow({
    id: slug,
    inputSchema: stepContextSchema,
    outputSchema: stepContextSchema,
  })
    .then(classifyStep)
    .branch([
      [
        async ({ inputData }: { inputData: { intent?: string } }) =>
          inputData.intent === "wismo",
        wismoPath,
      ],
      [
        async ({ inputData }: { inputData: { intent?: string } }) =>
          inputData.intent === "out-of-scope" ||
          inputData.intent === "unknown" ||
          !inputData.intent,
        escalateStep,
      ],
    ] as AnyWorkflow)
    .commit();

  return { [slug]: workflow };
}
