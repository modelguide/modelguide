import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { z } from "zod";
import type {
  DomainConfig,
  ExperimentConfig,
  ModelsConfig,
  PersonaConfig,
  ResolvedExperiment,
  RulesConfig,
  TaskConfig,
  ToolMocksConfig,
} from "./schemas.js";
import {
  DomainConfigSchema,
  ExperimentConfigSchema,
  ModelsConfigSchema,
  PersonaConfigSchema,
  RulesConfigSchema,
  TaskConfigSchema,
  ToolMocksConfigSchema,
} from "./schemas.js";

const CONFIG_DIR = path.resolve(import.meta.dir, "../../config");

/**
 * Substitute ${VAR:-default} patterns with env values.
 */
function substituteEnvVars(text: string): string {
  return text.replace(
    /\$\{(\w+)(?::-(.*?))?\}/g,
    (_match, varName: string, defaultValue?: string) => {
      const envVal = process.env[varName];
      if (envVal !== undefined) return envVal;
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(
        `Environment variable ${varName} is not set and has no default`,
      );
    },
  );
}

/**
 * Load and validate a YAML file against a Zod schema.
 */
export function loadYaml<S extends z.ZodType>(
  filePath: string,
  schema: S,
): z.output<S> {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(CONFIG_DIR, filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const substituted = substituteEnvVars(raw);
  const parsed = yaml.load(substituted);

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Validation error in ${absolutePath}:\n${errors}`);
  }

  return result.data;
}

/**
 * Load models registry.
 */
export function loadModels(): ModelsConfig {
  return loadYaml("models.yaml", ModelsConfigSchema);
}

/**
 * Load a domain config.
 */
export function loadDomain(name: string): DomainConfig {
  return loadYaml(`domains/${name}/domain.yaml`, DomainConfigSchema);
}

/**
 * Load verifier rules for a domain.
 */
export function loadRules(rulesPath: string): RulesConfig {
  return loadYaml(rulesPath, RulesConfigSchema);
}

/**
 * Load tool mocks for a domain (optional).
 */
export function loadToolMocks(domain: string): ToolMocksConfig | null {
  const filePath = path.resolve(CONFIG_DIR, `domains/${domain}/tool-mocks.yaml`);
  if (!fs.existsSync(filePath)) return null;
  return loadYaml(filePath, ToolMocksConfigSchema);
}

/**
 * Load a single task config.
 */
function loadTask(filePath: string): TaskConfig {
  return loadYaml(filePath, TaskConfigSchema);
}

/**
 * Load tasks for a domain, applying filters.
 */
export function loadTasks(
  domain: string,
  filter: "all" | { glob: string } | { list: string[] },
): TaskConfig[] {
  const tasksDir = path.resolve(CONFIG_DIR, `domains/${domain}/tasks`);

  if (!fs.existsSync(tasksDir)) {
    throw new Error(`Tasks directory not found: ${tasksDir}`);
  }

  let taskFiles: string[];

  if (filter === "all") {
    taskFiles = fs
      .readdirSync(tasksDir)
      .filter((f) => f.endsWith(".yaml"))
      .sort();
  } else if ("glob" in filter) {
    const pattern = filter.glob;
    taskFiles = fs
      .readdirSync(tasksDir)
      .filter((f) => f.endsWith(".yaml"))
      .filter((f) => {
        const regex = new RegExp(
          `^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
        );
        return regex.test(f);
      })
      .sort();
  } else {
    const allFiles = fs
      .readdirSync(tasksDir)
      .filter((f) => f.endsWith(".yaml"))
      .sort();
    taskFiles = filter.list.map((id) => {
      // Match by filename substring or by loading and checking task_id
      let match = allFiles.find((f) => f.includes(id));
      if (!match) {
        // Try matching by task_id inside the YAML
        match = allFiles.find((f) => {
          const content = fs.readFileSync(path.join(tasksDir, f), "utf-8");
          return content.includes(`task_id: ${id}`);
        });
      }
      if (!match) throw new Error(`Task file not found for id: ${id}`);
      return match;
    });
  }

  return taskFiles.map((f) => loadTask(path.join(tasksDir, f)));
}

/**
 * Load a user persona config.
 */
export function loadPersona(name: string): PersonaConfig {
  return loadYaml(`user-personas/${name}.yaml`, PersonaConfigSchema);
}

/**
 * Load an experiment config by name.
 */
export function loadExperiment(name: string): ExperimentConfig {
  return loadYaml(`experiments/${name}.yaml`, ExperimentConfigSchema);
}

/**
 * Fully resolve an experiment: load all referenced configs.
 */
export function resolveExperiment(name: string): ResolvedExperiment {
  const experiment = loadExperiment(name);
  const exp = experiment.experiment;

  const domain = loadDomain(exp.domain);
  const models = loadModels();
  const tasks = loadTasks(exp.domain, exp.tasks);
  const toolMocks = loadToolMocks(exp.domain);

  // Collect unique persona refs from tasks
  const personaRefs = [...new Set(tasks.map((t) => t.user.persona))];
  const personas: Record<string, PersonaConfig> = {};
  for (const ref of personaRefs) {
    personas[ref] = loadPersona(ref);
  }

  // Load rules if any config uses rules verifier
  let rules: RulesConfig | null = null;
  for (const config of Object.values(exp.configs)) {
    if (config.verifier.type === "rules" && config.verifier.rules_file) {
      rules = loadRules(config.verifier.rules_file);
      break;
    }
  }

  return {
    name: exp.name,
    description: exp.description,
    domain,
    rules,
    toolMocks,
    tasks,
    personas,
    models,
    trials: exp.trials,
    configs: exp.configs,
    orchestrator: exp.orchestrator,
    metrics: exp.metrics,
    output: exp.output,
  };
}

/**
 * List available experiments.
 */
export function listExperiments(): string[] {
  const dir = path.resolve(CONFIG_DIR, "experiments");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(".yaml", ""));
}

/**
 * List available domains.
 */
export function listDomains(): string[] {
  const dir = path.resolve(CONFIG_DIR, "domains");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isDirectory());
}
