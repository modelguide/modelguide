import { z } from "zod";

// --- Models Registry ---

export const ModelEntrySchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().positive().default(4096),
});

export const ModelsConfigSchema = z.object({
  models: z.record(z.string(), ModelEntrySchema),
});

export type ModelsConfig = z.output<typeof ModelsConfigSchema>;

// --- Domain Config ---

export const McpConnectionSchema = z.object({
  base_url: z.string(),
  api_key: z.string(),
  agent_id: z.string(),
});

export const ToolSemanticSchema = z.object({
  type: z.enum(["query", "mutation", "lookup"]),
  description: z.string().optional(),
  requires_confirmation: z.boolean().default(false),
});

export const DomainConfigSchema = z.object({
  domain: z.object({
    name: z.string(),
    mcp: McpConnectionSchema,
    agent_persona: z.string(),
    policy: z.string(),
    tool_semantics: z.record(z.string(), ToolSemanticSchema).default({}),
  }),
});

export type DomainConfig = z.output<typeof DomainConfigSchema>;

// --- Rules Config ---

export const RuleTriggerSchema = z.object({
  tool: z.string().optional(),
  tool_type: z.enum(["query", "mutation", "lookup"]).optional(),
  type: z.enum(["tool_call", "agent_message"]).optional(),
  params: z
    .record(
      z.string(),
      z.object({
        gt: z.number().optional(),
        lt: z.number().optional(),
        in: z.array(z.string()).optional(),
        not_in: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export const RuleConditionSchema = z.object({
  conversation_must_contain: z
    .array(
      z.object({
        pattern: z.string(),
        from: z.enum(["user", "assistant"]).optional(),
        within_last_n_turns: z.number().positive().optional(),
      }),
    )
    .optional(),
  conversation_must_not_contain: z
    .array(
      z.object({
        pattern: z.string(),
        from: z.enum(["user", "assistant"]).optional(),
      }),
    )
    .optional(),
  message_must_not_contain: z
    .array(
      z.object({
        pattern: z.string(),
      }),
    )
    .optional(),
  params_grounded_in_conversation: z
    .array(
      z.object({
        param: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  pre_check: z
    .object({
      tool: z.string(),
      params_from: z.record(z.string(), z.string()),
      expect: z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.object({
            in: z.array(z.string()).optional(),
            not_in: z.array(z.string()).optional(),
            gt: z.number().optional(),
            lt: z.number().optional(),
          }),
        ]),
      ),
    })
    .optional(),
  within_last_n_turns: z.number().positive().optional(),
});

export const VerifierRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(["error", "warning", "info"]).default("error"),
  trigger: RuleTriggerSchema,
  condition: RuleConditionSchema,
  on_fail: z.object({
    action: z.enum(["reject", "escalate", "redact", "rewrite"]),
    message: z.string(),
  }),
});

export const RulesConfigSchema = z.object({
  rules: z.array(VerifierRuleSchema),
});

export type RulesConfig = z.output<typeof RulesConfigSchema>;
export type VerifierRule = z.output<typeof VerifierRuleSchema>;

// --- Task Config ---

export const TaskExpectedSchema = z.object({
  action_sequence: z.array(z.string()).optional(),
  must: z.array(z.string()).optional(),
  must_not: z.array(z.string()).optional(),
  outcome: z.string().optional(),
});

export const TaskVerifierExpectedSchema = z.object({
  should_trigger: z.array(z.string()).optional(),
  should_not_trigger: z.array(z.string()).optional(),
});

export const TaskConfigSchema = z.object({
  task_id: z.string(),
  title: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  tags: z.array(z.string()).default([]),
  user: z.object({
    persona: z.string(),
    intent: z.string(),
    hidden_context: z.record(z.string(), z.unknown()).default({}),
  }),
  expected: TaskExpectedSchema,
  verifier_expected: TaskVerifierExpectedSchema.optional(),
});

export type TaskConfig = z.output<typeof TaskConfigSchema>;

// --- Persona Config ---

export const PersonaConfigSchema = z.object({
  persona_id: z.string(),
  display_name: z.string(),
  system_prompt: z.string(),
  response_style: z
    .object({
      tone: z.string().optional(),
      verbosity: z.enum(["terse", "normal", "verbose"]).default("normal"),
      cooperativeness: z.enum(["low", "medium", "high"]).default("high"),
    })
    .default({}),
  stop_conditions: z
    .object({
      max_turns: z.number().positive().default(20),
      on_resolution: z.boolean().default(true),
      on_escalation: z.boolean().default(true),
    })
    .default({}),
});

export type PersonaConfig = z.output<typeof PersonaConfigSchema>;

// --- Experiment Config ---

export const VerifierSettingSchema = z.object({
  type: z.enum(["none", "rules", "llm"]),
  rules_file: z.string().optional(),
});

export const ExperimentConfigEntrySchema = z.object({
  agent_model: z.string(),
  user_model: z.string(),
  verifier: VerifierSettingSchema,
});

export const ExperimentOrchestratorSchema = z.object({
  max_turns: z.number().positive().default(30),
  timeout_seconds: z.number().positive().default(120),
  concurrent_tasks: z.number().positive().default(1),
});

export const ExperimentOutputSchema = z.object({
  dir: z.string().default("results"),
  save_traces: z.boolean().default(true),
  save_verifier_log: z.boolean().default(true),
});

export const ExperimentConfigSchema = z.object({
  experiment: z.object({
    name: z.string(),
    description: z.string(),
    domain: z.string(),
    tasks: z.union([
      z.literal("all"),
      z.object({ glob: z.string() }),
      z.object({ list: z.array(z.string()) }),
    ]),
    trials: z.number().positive().default(3),
    configs: z.record(z.string(), ExperimentConfigEntrySchema),
    orchestrator: ExperimentOrchestratorSchema.default({}),
    metrics: z
      .array(z.string())
      .default([
        "task_success_rate",
        "policy_violation_rate",
        "verifier_intervention_rate",
        "mean_turns_to_resolution",
        "cost_per_task",
      ]),
    output: ExperimentOutputSchema.default({}),
  }),
});

export type ExperimentConfig = z.output<typeof ExperimentConfigSchema>;

// --- Resolved types (after loading all refs) ---

export interface ResolvedExperiment {
  name: string;
  description: string;
  domain: DomainConfig;
  rules: RulesConfig | null;
  tasks: TaskConfig[];
  personas: Record<string, PersonaConfig>;
  models: ModelsConfig;
  trials: number;
  configs: Record<string, z.output<typeof ExperimentConfigEntrySchema>>;
  orchestrator: z.output<typeof ExperimentOrchestratorSchema>;
  metrics: string[];
  output: z.output<typeof ExperimentOutputSchema>;
}
