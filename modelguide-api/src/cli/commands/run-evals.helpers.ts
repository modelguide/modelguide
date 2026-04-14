export interface TestCaseResult {
  testCaseId: string | null;
  testCaseName: string | null;
  evalRunId: string;
  sessionId?: string | null;
  passed: boolean | null;
  status: string;
  scores: Array<{ name: string; result: string; reasoning?: string }>;
}

/** Compute pass rate as an integer 0-100. Errored cases (passed=null) excluded from denominator. */
export function computePassRate(results: TestCaseResult[]): number {
  const scored = results.filter((r) => r.passed !== null);
  if (scored.length === 0) return 0;
  const passed = scored.filter((r) => r.passed === true).length;
  return Math.round((passed / scored.length) * 100);
}

/** Format a results table as a printable string. */
export function formatResultsTable(results: TestCaseResult[]): string {
  const lines: string[] = [];
  const passRate = computePassRate(results);

  for (const r of results) {
    const label = r.passed === true ? "PASS" : r.passed === false ? "FAIL" : "ERROR";
    const name = r.testCaseName ?? r.testCaseId ?? "unknown";
    lines.push(`  ${label.padEnd(6)} ${name}`);
    if (r.passed === false) {
      for (const s of r.scores.filter((sc) => sc.result === "fail")) {
        lines.push(
          `         ↳ ${s.name}: ${s.reasoning?.slice(0, 120) ?? "no detail"}`,
        );
      }
    }
  }

  const passed = results.filter((r) => r.passed === true).length;
  const scored = results.filter((r) => r.passed !== null).length;
  lines.push("");
  lines.push(`Pass rate: ${passed}/${scored} (${passRate}%)`);
  return lines.join("\n");
}

export function buildMissingAdminUserMessage(orgRef: string): string {
  return (
    `No admin user found for org "${orgRef}".\n` +
    "Create one first, for example:\n" +
    `mg add-users --org ${orgRef} email=founder@example.com name="Founder" role=admin`
  );
}
