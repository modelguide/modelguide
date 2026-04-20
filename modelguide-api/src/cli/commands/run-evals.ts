/**
 * mg run-evals — simulate all eval suites for an org and print scored results.
 *
 * Internally generates a short-lived admin JWT so the caller never needs to
 * manage tokens. The API server must be running at http://localhost:3000.
 *
 * Future: when all usage is local, replace internal JWT with a localhost
 * bypass on the simulation endpoints (ALLOW_LOCAL_SIM=true).
 */

import { forApp } from "@db/rls";
import { users } from "@db/schema";
import type { Command } from "commander";
import { and, eq } from "drizzle-orm";
import { sign } from "hono/jwt";
import { getErrorMessage } from "../lib/errors";
import { log } from "../lib/logger";
import { fetchAllPages } from "../lib/paginate";
import { resolveOrgId } from "../lib/resolve-org";
import {
  type TestCaseResult,
  buildMissingAdminUserMessage,
  formatResultsTable,
} from "./run-evals.helpers";
import {
  type RunEvalsAgentSummary,
  type RunEvalsSopSummary,
  type RunEvalsSuiteSummary,
  selectRunEvalsSuites,
} from "./run-evals.selection";

export {
  buildMissingAdminUserMessage,
  computePassRate,
  formatResultsTable,
} from "./run-evals.helpers";

const API_PORT = process.env.PORT ?? "3000";
const API_BASE = `http://localhost:${API_PORT}`;
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
const HEALTH_TIMEOUT_MS = 3_000;
const PAGE_SIZE = 100;

// ============================================================================
// Internal: JWT generation
// ============================================================================

async function generateInternalJwt(
  orgId: string,
  orgRef: string,
): Promise<string> {
  const { env } = await import("@/env");

  // Find the first admin user in this org (bypass RLS since this is an internal CLI op)
  const rows = await forApp(async (tx) => {
    return tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        organizationId: users.organizationId,
      })
      .from(users)
      .where(and(eq(users.organizationId, orgId), eq(users.role, "admin")))
      .limit(1);
  });

  if (rows.length === 0) {
    throw new Error(buildMissingAdminUserMessage(orgRef));
  }

  const u = rows[0];
  const now = Math.floor(Date.now() / 1000);
  const JWT_EXPIRY_SECONDS = 30 * 60; // 30 min — sufficient for a full eval run
  return sign(
    {
      type: "access",
      sub: u.id,
      email: u.email,
      name: u.name ?? "",
      role: u.role,
      org: u.organizationId,
      iat: now,
      exp: now + JWT_EXPIRY_SECONDS,
    },
    env.JWT_SECRET,
    "HS256",
  );
}

// ============================================================================
// Internal: API helpers
// ============================================================================

async function apiFetch(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `API ${options?.method ?? "GET"} ${path} → ${res.status}: ${body}`,
    );
  }
  return res.json();
}

async function pollUntilDone(
  suiteId: string,
  runId: string,
  token: string,
): Promise<{ status: string; testCaseResults: TestCaseResult[] }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = (await apiFetch(
      `/api/eval-suites/${suiteId}/runs/${runId}`,
      token,
    )) as { status?: string; testCaseResults?: TestCaseResult[] };

    if (typeof run.status !== "string") {
      throw new Error(
        `Unexpected poll response from /runs/${runId}: ${JSON.stringify(run)}`,
      );
    }

    if (
      run.status === "completed" ||
      run.status === "completed_with_errors" ||
      run.status === "failed"
    ) {
      return {
        status: run.status,
        testCaseResults: run.testCaseResults ?? [],
      };
    }

    log.info(`  Suite ${suiteId}: ${run.status} — waiting...`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for suite run ${runId}`);
}

// ============================================================================
// Public handler
// ============================================================================

interface AgentSummary {
  id: string;
  slug: string;
  name: string;
  compiledInstructions: string | null;
}

export async function handleRunEvals(
  orgId: string,
  agentSlug?: string,
  orgRef = orgId,
  suiteSlugs?: string[],
  concurrency?: number,
): Promise<{ totalPassed: number; totalScored: number; passRate: number }> {
  // 1. Health check — bounded so a hung API doesn't make the CLI appear frozen.
  const healthy = await fetch(`${API_BASE}/api/health`, {
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (!healthy) {
    throw new Error(
      `ModelGuide API is not running at ${API_BASE}.\nStart it with: make api-dev\nThen re-run: mg run-evals --org <slug>`,
    );
  }

  // 2. Internal JWT (hidden from caller)
  const token = await generateInternalJwt(orgId, orgRef);

  const requestedSuiteSlugs = [
    ...new Set((suiteSlugs ?? []).filter((slug) => slug.length > 0)),
  ];

  // 3. List eval suites and agents (we always need agents to look up
  //    compiledInstructions for the precheck). Drain every page — an org
  //    with >PAGE_SIZE suites must still run them all.
  const listPaginated = <T>(pathWithoutPage: string, label: string) =>
    fetchAllPages<T>(
      async (page) => {
        const sep = pathWithoutPage.includes("?") ? "&" : "?";
        const resp = (await apiFetch(
          `${pathWithoutPage}${sep}page=${page}&pageSize=${PAGE_SIZE}`,
          token,
        )) as { data: T[]; pagination: { hasNextPage: boolean } };
        return resp;
      },
      { pageSize: PAGE_SIZE, label },
    );

  const [allSuites, allAgents, allSops] = await Promise.all([
    listPaginated<RunEvalsSuiteSummary>("/api/eval-suites", "eval suites"),
    listPaginated<AgentSummary>("/api/agents", "agents"),
    requestedSuiteSlugs.length > 0
      ? listPaginated<RunEvalsSopSummary>("/api/sops", "SOPs")
      : Promise.resolve([] as RunEvalsSopSummary[]),
  ]);

  const agentsById = new Map(allAgents.map((a) => [a.id, a]));
  const suites = selectRunEvalsSuites({
    suites: allSuites,
    agents: allAgents.map(
      (agent): RunEvalsAgentSummary => ({
        id: agent.id,
        slug: agent.slug,
      }),
    ),
    sops: allSops,
    agentSlug,
    suiteSlugs: requestedSuiteSlugs,
  });

  if (suites.length === 0) {
    log.warn("No eval suites found. Did you run mg import-evals?");
    return { totalPassed: 0, totalScored: 0, passRate: 0 };
  }

  // 4. Precheck: every suite's agent must have a compiled prompt — we hardcode
  //    promptSource="compiled", so uncompiled agents would only fail inside the
  //    simulation engine with an opaque message.
  const uncompiled = new Set<string>();
  for (const suite of suites) {
    const agent = agentsById.get(suite.agentId);
    if (agent && agent.compiledInstructions === null) {
      uncompiled.add(agent.slug);
    }
  }
  if (uncompiled.size > 0) {
    const slugs = [...uncompiled].sort();
    throw new Error(
      `Agent(s) have no compiled prompt: ${slugs.join(", ")}\n` +
        `Run 'mg compile-agents --org ${orgRef}' and re-run this command.`,
    );
  }

  // Suite-level parallelism: run up to SUITE_PARALLELISM suites simultaneously.
  // The API task runner is fire-and-forget, so each suite runs in its own task
  // with its own bounded test-case pool. Total worst-case LLM concurrency is
  // SUITE_PARALLELISM × testCaseConcurrency — keep suite parallelism modest
  // so we don't overshoot provider rate limits.
  const SUITE_PARALLELISM = 3;
  const suitePoolSize = Math.min(SUITE_PARALLELISM, suites.length);

  const concurrencyNote =
    concurrency !== undefined ? ` (test-case concurrency ${concurrency})` : "";
  log.info(
    `Running ${suites.length} eval suite(s) with ${suitePoolSize} suite(s) in parallel${concurrencyNote}`,
  );

  // 5. Trigger + poll each suite (up to suitePoolSize in flight at once).
  //    Per-suite outputs are printed as a single block once the suite finishes
  //    so interleaved runs don't scramble the reader's view.
  let totalPassed = 0;
  let totalScored = 0;

  let suiteCursor = 0;
  async function suiteWorker(): Promise<void> {
    while (true) {
      const idx = suiteCursor++;
      if (idx >= suites.length) return;
      const suite = suites[idx];

      const runResp = (await apiFetch(
        `/api/eval-suites/${suite.id}/simulate-and-run`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            promptSource: "compiled",
            ...(concurrency !== undefined ? { concurrency } : {}),
          }),
        },
      )) as { suiteRunId: string };

      const result = await pollUntilDone(suite.id, runResp.suiteRunId, token);
      const resultTable = formatResultsTable(result.testCaseResults);
      // Print the suite header + table as a contiguous block.
      log.info(`\nSuite: ${suite.name}\n${resultTable}`);

      const scored = result.testCaseResults.filter(
        (r) => r.passed !== null,
      ).length;
      const passed = result.testCaseResults.filter(
        (r) => r.passed === true,
      ).length;
      totalPassed += passed;
      totalScored += scored;
    }
  }

  await Promise.all(Array.from({ length: suitePoolSize }, () => suiteWorker()));

  const passRate =
    totalScored > 0 ? Math.round((totalPassed / totalScored) * 100) : 0;

  log.info(`\nTotal: ${totalPassed}/${totalScored} passed (${passRate}%)`);
  return { totalPassed, totalScored, passRate };
}

function collectRepeatedSuites(value: string, previous: string[]): string[] {
  return [...previous, value];
}

// ============================================================================
// Commander registration
// ============================================================================

export function registerRunEvalsCommand(program: Command): void {
  program
    .command("run-evals")
    .description("Run all eval suites for an org through the simulation engine")
    .requiredOption("--org <slug>", "Organization slug")
    .option("--agent <slug>", "Only run suites for this agent")
    .option(
      "--suite <slug>",
      "Only run suites for this SOP slug (repeatable)",
      collectRepeatedSuites,
      [],
    )
    .option(
      "--concurrency <n>",
      "Max concurrent test cases per suite (1–20). Falls back to EVAL_CONCURRENCY env, then API default (5).",
      (v) => {
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1 || n > 20) {
          throw new Error("--concurrency must be an integer between 1 and 20");
        }
        return n;
      },
    )
    .action(
      async (opts: {
        org: string;
        agent?: string;
        suite: string[];
        concurrency?: number;
      }) => {
        const orgId = await resolveOrgId(opts.org);
        // Env fallback when the flag is not passed. CLI flag still wins.
        let concurrency = opts.concurrency;
        if (concurrency === undefined && process.env.EVAL_CONCURRENCY) {
          const parsed = Number.parseInt(process.env.EVAL_CONCURRENCY, 10);
          if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
            concurrency = parsed;
          } else {
            log.warn(
              `Ignoring invalid EVAL_CONCURRENCY="${process.env.EVAL_CONCURRENCY}" (expected integer 1–20)`,
            );
          }
        }
        try {
          await handleRunEvals(
            orgId,
            opts.agent,
            opts.org,
            opts.suite,
            concurrency,
          );
        } catch (err) {
          log.error(`Failed: ${getErrorMessage(err)}`);
          process.exit(1);
        }
      },
    );
}
