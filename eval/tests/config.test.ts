import { describe, expect, test } from "bun:test";
import {
  listDomains,
  listExperiments,
  loadDomain,
  loadModels,
  loadPersona,
  loadRules,
  loadTasks,
  resolveExperiment,
} from "../src/config/loader.js";
import {
  DomainConfigSchema,
  ExperimentConfigSchema,
  ModelsConfigSchema,
  PersonaConfigSchema,
  RulesConfigSchema,
  TaskConfigSchema,
} from "../src/config/schemas.js";

describe("Config Schemas", () => {
  test("ModelsConfigSchema validates valid config", () => {
    const result = ModelsConfigSchema.safeParse({
      models: {
        "gpt-4o-mini": {
          provider: "openai",
          model: "gpt-4o-mini",
          temperature: 0.7,
          max_tokens: 4096,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("DomainConfigSchema validates valid config", () => {
    const result = DomainConfigSchema.safeParse({
      domain: {
        name: "Test Domain",
        mcp: {
          base_url: "http://localhost:3000",
          api_key: "mgk_test",
          agent_id: "123",
        },
        agent_persona: "You are a test agent",
        policy: "Be nice",
      },
    });
    expect(result.success).toBe(true);
  });

  test("RulesConfigSchema validates rules with all condition types", () => {
    const result = RulesConfigSchema.safeParse({
      rules: [
        {
          id: "test-rule",
          description: "Test rule",
          severity: "error",
          trigger: { tool: "test_tool" },
          condition: {
            conversation_must_contain: [{ pattern: "hello", from: "user" }],
          },
          on_fail: { action: "reject", message: "Blocked" },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("TaskConfigSchema validates task with expected outcomes", () => {
    const result = TaskConfigSchema.safeParse({
      task_id: "test_001",
      title: "Test Task",
      difficulty: "easy",
      tags: ["test"],
      user: {
        persona: "polite-straightforward",
        intent: "I need help",
        hidden_context: { name: "Jane" },
      },
      expected: {
        action_sequence: ["get_order"],
        must: ["Agent verifies identity"],
        must_not: ["Agent skips verification"],
        outcome: "resolved",
      },
      verifier_expected: {
        should_trigger: ["identity-check"],
        should_not_trigger: ["refund-limit"],
      },
    });
    expect(result.success).toBe(true);
  });

  test("PersonaConfigSchema validates persona", () => {
    const result = PersonaConfigSchema.safeParse({
      persona_id: "test-persona",
      display_name: "Test Persona",
      system_prompt: "You are a test customer",
      response_style: {
        tone: "friendly",
        verbosity: "normal",
        cooperativeness: "high",
      },
      stop_conditions: {
        max_turns: 10,
        on_resolution: true,
        on_escalation: true,
      },
    });
    expect(result.success).toBe(true);
  });

  test("ExperimentConfigSchema validates experiment", () => {
    const result = ExperimentConfigSchema.safeParse({
      experiment: {
        name: "test-experiment",
        description: "Test",
        domain: "test-domain",
        tasks: "all",
        trials: 2,
        configs: {
          baseline: {
            agent_model: "gpt-4o-mini",
            user_model: "gpt-4o-mini",
            verifier: { type: "none" },
          },
        },
        orchestrator: {
          max_turns: 10,
          timeout_seconds: 60,
          concurrent_tasks: 1,
        },
        metrics: ["task_success_rate"],
        output: { dir: "results", save_traces: true, save_verifier_log: true },
      },
    });
    expect(result.success).toBe(true);
  });

  test("ExperimentConfigSchema validates tasks as glob", () => {
    const result = ExperimentConfigSchema.safeParse({
      experiment: {
        name: "test",
        description: "Test",
        domain: "test",
        tasks: { glob: "001-*.yaml" },
        trials: 1,
        configs: {
          baseline: {
            agent_model: "gpt-4o-mini",
            user_model: "gpt-4o-mini",
            verifier: { type: "none" },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("ExperimentConfigSchema validates tasks as list", () => {
    const result = ExperimentConfigSchema.safeParse({
      experiment: {
        name: "test",
        description: "Test",
        domain: "test",
        tasks: { list: ["pp_001", "pp_002"] },
        trials: 1,
        configs: {
          baseline: {
            agent_model: "gpt-4o-mini",
            user_model: "gpt-4o-mini",
            verifier: { type: "none" },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("Config Loader", () => {
  test("loadModels loads models.yaml", () => {
    const models = loadModels();
    expect(models.models).toBeDefined();
    expect(models.models["gpt-4o-mini"]).toBeDefined();
    expect(models.models["gpt-4o-mini"].provider).toBe("openai");
  });

  test("loadDomain loads pizza-palace domain", () => {
    const domain = loadDomain("pizza-palace");
    expect(domain.domain.name).toBe("Pizza Palace");
    expect(domain.domain.tool_semantics).toBeDefined();
  });

  test("loadRules loads pizza-palace rules", () => {
    const rules = loadRules("domains/pizza-palace/rules.yaml");
    expect(rules.rules.length).toBeGreaterThan(0);
    expect(rules.rules[0].id).toBe("identity-before-lookup");
  });

  test("loadTasks loads all pizza-palace tasks", () => {
    const tasks = loadTasks("pizza-palace", "all");
    expect(tasks.length).toBe(3);
    expect(tasks[0].task_id).toBe("pp_001");
  });

  test("loadTasks filters by list", () => {
    const tasks = loadTasks("pizza-palace", {
      list: ["pp_001", "pp_003"],
    });
    expect(tasks.length).toBe(2);
  });

  test("loadPersona loads polite-straightforward", () => {
    const persona = loadPersona("polite-straightforward");
    expect(persona.persona_id).toBe("polite-straightforward");
    expect(persona.response_style.cooperativeness).toBe("high");
  });

  test("listExperiments finds experiments", () => {
    const experiments = listExperiments();
    expect(experiments).toContain("verifier-primacy-ab");
  });

  test("listDomains finds domains", () => {
    const domains = listDomains();
    expect(domains).toContain("pizza-palace");
  });

  test("resolveExperiment fully resolves verifier-primacy-ab", () => {
    const resolved = resolveExperiment("verifier-primacy-ab");
    expect(resolved.name).toBe("verifier-primacy-ab");
    expect(resolved.tasks.length).toBe(3);
    expect(resolved.domain.domain.name).toBe("Pizza Palace");
    expect(resolved.rules).not.toBeNull();
    expect(resolved.rules!.rules.length).toBe(8);
    expect(Object.keys(resolved.personas)).toContain("polite-straightforward");
    expect(Object.keys(resolved.configs)).toContain("baseline");
    expect(Object.keys(resolved.configs)).toContain("with-rules-verifier");
  });
});
