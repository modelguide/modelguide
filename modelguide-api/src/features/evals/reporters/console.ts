/**
 * Console reporter — logs eval results as structured JSON to stdout.
 * Default reporter for v1.
 */

import { getLogger } from "@lib/logger";
import type { EvalReporter, EvalRunReport } from "./reporter.types";

export const consoleReporter: EvalReporter = {
  name: "console",

  async report(
    run: EvalRunReport,
  ): Promise<{ externalRunId?: string; externalRunUrl?: string }> {
    const log = getLogger();
    const summary = {
      runId: run.runId,
      sessionId: run.sessionId,
      sourceType: run.sourceType,
      sourceName: run.sourceName,
      passed: run.passed,
      totalScores: run.scores.length,
      passCount: run.scores.filter((s) => s.result === "pass").length,
      failCount: run.scores.filter((s) => s.result === "fail").length,
      skipCount: run.scores.filter((s) => s.result === "skip").length,
      errorCount: run.scores.filter((s) => s.result === "error").length,
    };

    log.info({ evalReport: summary }, "eval run completed");

    // Log individual failures for visibility
    for (const score of run.scores) {
      if (score.result === "fail") {
        log.info(
          {
            evalScore: {
              name: score.name,
              evaluatorType: score.evaluatorType,
              failureClassification: score.failureClassification,
              reasoning: score.reasoning,
            },
          },
          "eval score: fail",
        );
      }
    }

    return {};
  },
};
