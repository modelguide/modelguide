/**
 * Reporter interface for eval result emission to external platforms.
 *
 * Local storage always happens first. Reporters are fire-and-forget on top.
 * If the reporter fails, the eval still succeeds — results are in eval_runs.
 */

export interface EvalRunReport {
  runId: string;
  sessionId: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  passed: boolean;
  scores: Array<{
    name: string;
    evalConfigId: string;
    evaluatorType: string;
    result: "pass" | "fail" | "skip" | "error";
    reasoning: string;
    failureClassification?: string;
    expected?: Record<string, unknown>;
    actual?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
}

export interface EvalReporter {
  readonly name: string;
  report(
    run: EvalRunReport,
  ): Promise<{ externalRunId?: string; externalRunUrl?: string }>;
}
