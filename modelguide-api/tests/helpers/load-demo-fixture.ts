/**
 * Loads a demo seed directory (agents.yaml, sops.yaml, guardrails.yaml)
 * and builds a CompilerInput for integration testing.
 *
 * Convention:
 *   <demoDir>/agents.yaml    — agent definitions with promptConfig
 *   <demoDir>/sops.yaml      — SOP definitions with steps
 *   <demoDir>/guardrails.yaml — guardrails with agent assignments
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CompilerInput,
  KnowledgeBaseDetailResponse,
  Modality,
  ModelFamily,
  SopDetailResponse,
} from "@features/compiler/core/types";
import yaml from "js-yaml";

interface DemoAgent {
  name: string;
  slug: string;
  description: string;
  modality: string;
  modelFamily: string;
  promptConfig?: {
    persona?: string;
    fillerPhrases?: string[];
    language?: string;
  };
}

interface DemoSopStep {
  id: string;
  instruction: string;
  required: boolean;
}

interface DemoSop {
  name: string;
  slug: string;
  description: string;
  status: string;
  agents: string[];
  trigger: { type: string; config: Record<string, unknown> };
  metadata?: {
    reasonCode?: string;
    tags?: string[];
    escalationTriggers?: string[];
  };
  preamble?: string;
  steps: DemoSopStep[];
}

interface DemoGuardrail {
  name: string;
  slug: string;
  description: string;
  content: string;
  config: {
    category?: string;
    priority: string;
    critical?: boolean;
    reason?: string;
    agents?: string[];
  };
}

interface LoadDemoFixtureOptions {
  agentSlug: string;
  sopSlug: string;
}

export function loadDemoFixture(
  demoDir: string,
  options: LoadDemoFixtureOptions,
): CompilerInput {
  const { agentSlug, sopSlug } = options;

  // Load YAML files
  const agentsRaw = yaml.load(
    readFileSync(join(demoDir, "agents.yaml"), "utf-8"),
  ) as { agents: DemoAgent[] };
  const sopsRaw = yaml.load(
    readFileSync(join(demoDir, "sops.yaml"), "utf-8"),
  ) as { sops: DemoSop[] };
  const guardrailsRaw = yaml.load(
    readFileSync(join(demoDir, "guardrails.yaml"), "utf-8"),
  ) as { guardrails: DemoGuardrail[] };

  // Find agent
  const agent = agentsRaw.agents.find((a) => a.slug === agentSlug);
  if (!agent) throw new Error(`Agent "${agentSlug}" not found in agents.yaml`);

  // Find SOP
  const sop = sopsRaw.sops.find((s) => s.slug === sopSlug);
  if (!sop) throw new Error(`SOP "${sopSlug}" not found in sops.yaml`);

  // Filter guardrails assigned to this agent
  const agentGuardrails = guardrailsRaw.guardrails.filter((g) =>
    g.config.agents?.includes(agentSlug),
  );

  // Map trigger — demo YAMLs may use types not in the compiler schema
  const VALID_TRIGGERS = [
    "channel",
    "intent_detected",
    "tool_present",
    "manual",
  ];
  const trigger = VALID_TRIGGERS.includes(sop.trigger.type)
    ? (sop.trigger as { type: "manual"; config: Record<string, never> })
    : ({ type: "manual", config: {} } as const);

  // Build SopDetailResponse
  const sopResponse: SopDetailResponse = {
    id: `sop-${sop.slug}`,
    name: sop.name,
    slug: sop.slug,
    description: sop.description,
    status: sop.status as "active" | "draft" | "archived",
    version: "1.0",
    assignedAgents: [],
    sopTemplateId: null,
    template: null,
    definition: {
      schemaVersion: 1,
      trigger,
      steps: sop.steps.map((step, i) => ({
        id: step.id,
        order: i + 1,
        instruction: step.instruction,
        required: step.required,
      })),
      metadata: sop.metadata ?? {},
    },
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };

  // Build guardrail responses
  const guardrailResponses: KnowledgeBaseDetailResponse[] = agentGuardrails.map(
    (g) => ({
      id: `g-${g.slug}`,
      type: "guardrail" as const,
      name: g.name,
      slug: g.slug,
      content: g.content.trim(),
      description: g.description,
      config: {
        category: g.config.category,
        priority: g.config.priority as "critical" | "high" | "medium" | "low",
        critical: g.config.critical,
        reason: g.config.reason,
      },
      isActive: true,
      assignedAgents: [],
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }),
  );

  const modality: Modality = agent.modality === "voice" ? "voice" : "text";

  const promptConfig = {
    persona: agent.promptConfig?.persona?.trim(),
    fillerPhrases: agent.promptConfig?.fillerPhrases,
    language: agent.promptConfig?.language,
  };

  return {
    sops: [sopResponse],
    guardrails: guardrailResponses,
    agentConfig: {
      id: `agent-${agent.slug}`,
      name: agent.name,
      model: "openai:gpt-4.1-mini",
      description: agent.description,
      promptConfig,
      modelFamily: agent.modelFamily as ModelFamily,
      modality,
    },
  };
}
