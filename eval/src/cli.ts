import { Command } from "commander";
import {
  listDomains,
  listExperiments,
  loadTasks,
  resolveExperiment,
} from "./config/loader.js";

const program = new Command();

program
  .name("modelguide-eval")
  .description("ModelGuide AI agent evaluation framework")
  .version("1.0.0");

// --- run ---
program
  .command("run")
  .description("Run an evaluation experiment")
  .requiredOption("--experiment <name>", "Experiment name")
  .option("--config <variant>", "Run only a specific config variant")
  .option("--task <id>", "Run only a specific task")
  .option("--trials <n>", "Override number of trials", Number.parseInt)
  .action(async (opts) => {
    const { ExperimentRunner } = await import("./runner.js");
    const resolved = resolveExperiment(opts.experiment);

    if (opts.trials) {
      resolved.trials = opts.trials;
    }

    if (opts.task) {
      resolved.tasks = resolved.tasks.filter((t) => t.task_id === opts.task);
      if (resolved.tasks.length === 0) {
        console.error(`Task not found: ${opts.task}`);
        process.exit(1);
      }
    }

    if (opts.config) {
      const entry = resolved.configs[opts.config];
      if (!entry) {
        console.error(
          `Config not found: ${opts.config}. Available: ${Object.keys(resolved.configs).join(", ")}`,
        );
        process.exit(1);
      }
      resolved.configs = { [opts.config]: entry };
    }

    const runner = new ExperimentRunner(resolved);
    const results = await runner.run();

    console.log("\n=== Experiment Complete ===");
    console.log(`Results saved to: ${results.outputDir}`);
  });

// --- list ---
const list = program.command("list").description("List available configs");

list
  .command("experiments")
  .description("List available experiments")
  .action(() => {
    const experiments = listExperiments();
    if (experiments.length === 0) {
      console.log("No experiments found in config/experiments/");
      return;
    }
    console.log("Available experiments:");
    for (const name of experiments) {
      console.log(`  - ${name}`);
    }
  });

list
  .command("tasks")
  .description("List tasks for a domain")
  .requiredOption("--domain <name>", "Domain name")
  .action((opts) => {
    const tasks = loadTasks(opts.domain, "all");
    if (tasks.length === 0) {
      console.log(`No tasks found for domain: ${opts.domain}`);
      return;
    }
    console.log(`Tasks for ${opts.domain}:`);
    for (const task of tasks) {
      console.log(
        `  ${task.task_id}: ${task.title} [${task.difficulty}] ${task.tags.join(", ")}`,
      );
    }
  });

list
  .command("domains")
  .description("List available domains")
  .action(() => {
    const domains = listDomains();
    if (domains.length === 0) {
      console.log("No domains found in config/domains/");
      return;
    }
    console.log("Available domains:");
    for (const name of domains) {
      console.log(`  - ${name}`);
    }
  });

// --- validate ---
program
  .command("validate")
  .description("Validate configuration files")
  .option("--experiment <name>", "Validate a specific experiment")
  .action((opts) => {
    try {
      if (opts.experiment) {
        const resolved = resolveExperiment(opts.experiment);
        console.log(`Experiment '${resolved.name}' is valid.`);
        console.log(`  Domain: ${resolved.domain.domain.name}`);
        console.log(`  Tasks: ${resolved.tasks.length}`);
        console.log(`  Configs: ${Object.keys(resolved.configs).join(", ")}`);
        console.log(`  Trials: ${resolved.trials}`);
        console.log(`  Personas: ${Object.keys(resolved.personas).join(", ")}`);
        if (resolved.rules) {
          console.log(`  Rules: ${resolved.rules.rules.length}`);
        }
      } else {
        // Validate all experiments
        const experiments = listExperiments();
        if (experiments.length === 0) {
          console.log("No experiments found.");
          return;
        }
        for (const name of experiments) {
          try {
            resolveExperiment(name);
            console.log(`  [OK] ${name}`);
          } catch (err) {
            console.error(
              `  [FAIL] ${name}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `Validation failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  });

// --- analyze ---
program
  .command("analyze")
  .description("Analyze experiment results (calls Python)")
  .requiredOption("--experiment <name>", "Experiment name")
  .action(async (opts) => {
    const { execSync } = await import("node:child_process");
    try {
      execSync(`python3 analysis/analyze.py --experiment ${opts.experiment}`, {
        cwd: import.meta.dir.replace("/src", ""),
        stdio: "inherit",
      });
    } catch {
      console.error("Analysis failed. Is Python installed with dependencies?");
      console.error("Run: pip install -r eval/analysis/requirements.txt");
      process.exit(1);
    }
  });

program.parse();
