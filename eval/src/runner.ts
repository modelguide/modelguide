import * as fs from "node:fs";
import * as path from "node:path";
import { EvalMcpClient } from "./clients/mcp-client.js";
import type { ResolvedExperiment } from "./config/schemas.js";
import { getEnv } from "./env.js";
import { Evaluator, computeAggregateMetrics } from "./evaluator.js";
import { Orchestrator } from "./orchestrator.js";
import type {
  ConfigResults,
  ConversationResult,
  ExperimentResults,
  TaskEvaluation,
  TaskResults,
  VerifierLogEntry,
} from "./types.js";
import { createVerifier } from "./verifier/index.js";

interface RunnerResults extends ExperimentResults {
  outputDir: string;
}

interface Job {
  taskId: string;
  configName: string;
  trialNumber: number;
}

export class ExperimentRunner {
  private experiment: ResolvedExperiment;
  private evaluator: Evaluator;

  constructor(experiment: ResolvedExperiment) {
    this.experiment = experiment;
    this.evaluator = new Evaluator();
  }

  async run(): Promise<RunnerResults> {
    const startedAt = new Date().toISOString();
    const env = getEnv();

    // Build job list
    const jobs: Job[] = [];
    for (const task of this.experiment.tasks) {
      for (const configName of Object.keys(this.experiment.configs)) {
        for (let trial = 1; trial <= this.experiment.trials; trial++) {
          jobs.push({
            taskId: task.task_id,
            configName,
            trialNumber: trial,
          });
        }
      }
    }

    console.error(`\nRunning experiment: ${this.experiment.name}`);
    console.error(
      `  ${jobs.length} jobs (${this.experiment.tasks.length} tasks x ${Object.keys(this.experiment.configs).length} configs x ${this.experiment.trials} trials)`,
    );
    console.error(
      `  Concurrency: ${this.experiment.orchestrator.concurrent_tasks}\n`,
    );

    // Execute jobs with concurrency limit
    const results: ConversationResult[] = [];
    const concurrency = this.experiment.orchestrator.concurrent_tasks;
    let completed = 0;

    const runJob = async (job: Job): Promise<ConversationResult | null> => {
      const task = this.experiment.tasks.find((t) => t.task_id === job.taskId)!;
      const configEntry = this.experiment.configs[job.configName];
      const persona = this.experiment.personas[task.user.persona];

      if (!persona) {
        console.error(`  [SKIP] Persona not found: ${task.user.persona}`);
        return null;
      }

      // Create a temporary MCP client for verifier pre-checks
      const mcp = this.experiment.domain.domain.mcp;
      const verifierMcpClient = new EvalMcpClient({
        baseUrl: mcp.base_url,
        agentId: mcp.agent_id,
        apiKey: mcp.api_key,
      });

      const verifier = createVerifier(
        configEntry.verifier,
        this.experiment.domain,
        verifierMcpClient,
      );

      const orchestrator = new Orchestrator({
        domain: this.experiment.domain,
        task,
        persona,
        models: this.experiment.models,
        agentModelName: configEntry.agent_model,
        userModelName: configEntry.user_model,
        verifier,
        maxTurns: this.experiment.orchestrator.max_turns,
        timeoutSeconds: this.experiment.orchestrator.timeout_seconds,
        openaiApiKey: env.OPENAI_API_KEY,
        configName: job.configName,
        trialNumber: job.trialNumber,
      });

      try {
        const result = await orchestrator.run();
        completed++;
        const statusIcon = result.status === "completed" ? "OK" : "ERR";
        console.error(
          `  [${completed}/${jobs.length}] ${job.taskId} trial ${job.trialNumber} (${job.configName}) ${statusIcon} ${result.turnCount} turns`,
        );
        return result;
      } catch (err) {
        completed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `  [${completed}/${jobs.length}] ${job.taskId} trial ${job.trialNumber} (${job.configName}) FAIL: ${msg}`,
        );
        return null;
      }
    };

    // Semaphore-based concurrency
    const semaphore = new Semaphore(concurrency);
    const promises = jobs.map(async (job) => {
      await semaphore.acquire();
      try {
        const result = await runJob(job);
        if (result) results.push(result);
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);

    // Evaluate results
    const configResults: Record<string, ConfigResults> = {};
    const allVerifierLogs: VerifierLogEntry[] = [];

    for (const configName of Object.keys(this.experiment.configs)) {
      const configConversations = results.filter(
        (r) => r.configName === configName,
      );

      const taskResults: Record<string, TaskResults> = {};
      const evaluations: TaskEvaluation[] = [];

      for (const task of this.experiment.tasks) {
        const taskConversations = configConversations.filter(
          (r) => r.taskId === task.task_id,
        );

        const taskEvals = taskConversations.map((r) =>
          this.evaluator.evaluate(r, task),
        );
        evaluations.push(...taskEvals);

        taskResults[task.task_id] = {
          taskId: task.task_id,
          trials: taskConversations,
          evaluations: taskEvals,
        };

        // Collect verifier logs
        for (const r of taskConversations) {
          allVerifierLogs.push(...r.verifierLog);
        }
      }

      configResults[configName] = {
        configName,
        tasks: taskResults,
        aggregateMetrics: computeAggregateMetrics(
          evaluations,
          this.experiment.metrics,
        ),
      };
    }

    // Compute verifier delta
    const verifierDelta: Record<string, number> = {};
    const configNames = Object.keys(configResults);
    if (configNames.length === 2) {
      const [a, b] = configNames;
      const metricsA = configResults[a].aggregateMetrics;
      const metricsB = configResults[b].aggregateMetrics;

      for (const metric of this.experiment.metrics) {
        const valA = metricsA[metric] ?? 0;
        const valB = metricsB[metric] ?? 0;
        verifierDelta[`${metric}_delta`] = valB - valA;
      }
    }

    const endedAt = new Date().toISOString();

    // Write results
    const outputDir = this.writeResults(
      configResults,
      verifierDelta,
      allVerifierLogs,
      results,
      startedAt,
      endedAt,
    );

    // Print summary
    this.printSummary(configResults, verifierDelta);

    return {
      experimentName: this.experiment.name,
      startedAt,
      endedAt,
      configs: configResults,
      verifierDelta,
      outputDir,
    };
  }

  private writeResults(
    configResults: Record<string, ConfigResults>,
    verifierDelta: Record<string, number>,
    verifierLogs: VerifierLogEntry[],
    traces: ConversationResult[],
    startedAt: string,
    endedAt: string,
  ): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dirName = `${dateStr}_${this.experiment.name}`;
    const outputBase = path.resolve(
      import.meta.dir,
      "..",
      this.experiment.output.dir,
    );
    const outputDir = path.join(outputBase, dirName);

    fs.mkdirSync(outputDir, { recursive: true });

    // summary.json
    const summary = {
      experiment: this.experiment.name,
      description: this.experiment.description,
      startedAt,
      endedAt,
      configs: Object.fromEntries(
        Object.entries(configResults).map(([name, cr]) => [
          name,
          { aggregateMetrics: cr.aggregateMetrics },
        ]),
      ),
      verifier_delta: verifierDelta,
    };
    fs.writeFileSync(
      path.join(outputDir, "summary.json"),
      JSON.stringify(summary, null, 2),
    );

    // verifier-log.json
    if (this.experiment.output.save_verifier_log) {
      fs.writeFileSync(
        path.join(outputDir, "verifier-log.json"),
        JSON.stringify(verifierLogs, null, 2),
      );
    }

    // traces/
    if (this.experiment.output.save_traces) {
      const tracesDir = path.join(outputDir, "traces");
      fs.mkdirSync(tracesDir, { recursive: true });

      for (const trace of traces) {
        const filename = `${trace.taskId}-trial-${trace.trialNumber}-${trace.configName}.json`;
        fs.writeFileSync(
          path.join(tracesDir, filename),
          JSON.stringify(trace, null, 2),
        );
      }
    }

    return outputDir;
  }

  private printSummary(
    configResults: Record<string, ConfigResults>,
    verifierDelta: Record<string, number>,
  ): void {
    console.log("\n=== Results Summary ===\n");

    for (const [name, cr] of Object.entries(configResults)) {
      console.log(`Config: ${name}`);
      for (const [metric, value] of Object.entries(cr.aggregateMetrics)) {
        const formatted =
          typeof value === "number" && value < 1 && value > 0
            ? `${(value * 100).toFixed(1)}%`
            : typeof value === "number"
              ? value.toFixed(3)
              : value;
        console.log(`  ${metric}: ${formatted}`);
      }
      console.log();
    }

    if (Object.keys(verifierDelta).length > 0) {
      console.log("Verifier Delta (B - A):");
      for (const [metric, value] of Object.entries(verifierDelta)) {
        const sign = value >= 0 ? "+" : "";
        const formatted =
          Math.abs(value) < 1
            ? `${sign}${(value * 100).toFixed(1)}pp`
            : `${sign}${value.toFixed(3)}`;
        console.log(`  ${metric}: ${formatted}`);
      }
    }
  }
}

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
