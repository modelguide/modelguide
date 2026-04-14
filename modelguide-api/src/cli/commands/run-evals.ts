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
import { resolveOrgId } from "../lib/resolve-org";
import {
  type TestCaseResult,
  buildMissingAdminUserMessage,
  formatResultsTable,
} from "./run-evals.helpers";

export {
  buildMissingAdminUserMessage,
  computePassRate,
  formatResultsTable,
} from "./run-evals.helpers";

const API_BASE = "http://localhost:3000";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

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
  const JWT_EXPIRY_SECONDS = 4 * 60 * 60; // 4h for CLI eval sessions
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

export async function handleRunEvals(
  orgId: string,
  agentSlug?: string,
  orgRef = orgId,
): Promise<{ totalPassed: number; totalScored: number; passRate: number }> {
  // 1. Health check
  const healthy = await fetch(`${API_BASE}/api/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!healthy) {
    throw new Error(
      "ModelGuide API is not running at http://localhost:3000.\n" +
        "Start it with: make api-dev\n" +
        "Then re-run: mg run-evals --org <slug>",
    );
  }

  // 2. Internal JWT (hidden from caller)
  const token = await generateInternalJwt(orgId, orgRef);

  // 3. List eval suites
  const suitesResp = (await apiFetch(
    "/api/eval-suites?page=1&pageSize=50",
    token,
  )) as { data: Array<{ id: string; name: string; agentId: string }> };

  let suites = suitesResp.data;
  if (agentSlug) {
    // Filter by agentSlug: fetch agents list and match
    const agentsResp = (await apiFetch(
      "/api/agents?page=1&pageSize=50",
      token,
    )) as { data: Array<{ id: string; slug: string }> };
    const agent = agentsResp.data.find((a) => a.slug === agentSlug);
    if (!agent) throw new Error(`Agent "${agentSlug}" not found in org`);
    suites = suites.filter((s) => s.agentId === agent.id);
  }

  if (suites.length === 0) {
    log.warn("No eval suites found. Did you run mg import-evals?");
    return { totalPassed: 0, totalScored: 0, passRate: 0 };
  }

  log.info(`Running ${suites.length} eval suite(s)...`);

  // 4. Trigger + poll each suite
  let totalPassed = 0;
  let totalScored = 0;

  for (const suite of suites) {
    log.info(`\nSuite: ${suite.name}`);

    const runResp = (await apiFetch(
      `/api/eval-suites/${suite.id}/simulate-and-run`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ promptSource: "compiled" }),
      },
    )) as { suiteRunId: string };

    const result = await pollUntilDone(suite.id, runResp.suiteRunId, token);
    const resultTable = formatResultsTable(result.testCaseResults);
    log.info(resultTable);

    const scored = result.testCaseResults.filter(
      (r) => r.passed !== null,
    ).length;
    const passed = result.testCaseResults.filter(
      (r) => r.passed === true,
    ).length;
    totalPassed += passed;
    totalScored += scored;
  }

  const passRate =
    totalScored > 0 ? Math.round((totalPassed / totalScored) * 100) : 0;

  log.info(`\nTotal: ${totalPassed}/${totalScored} passed (${passRate}%)`);
  return { totalPassed, totalScored, passRate };
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
    .action(async (opts: { org: string; agent?: string }) => {
      const orgId = await resolveOrgId(opts.org);
      try {
        await handleRunEvals(orgId, opts.agent, opts.org);
      } catch (err) {
        log.error(`Failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
