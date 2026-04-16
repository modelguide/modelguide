/**
 * Eval runner — single test case e2e regression test.
 *
 * Reproduces the "infinite loop / stuck run" scenario reported against suite
 * aa81d9cc-0f31-4131-b891-295cea17bf60.
 *
 * What this verifies:
 * 1. enqueueSimulateAndRun returns a suiteRunId immediately (HTTP 202 pattern)
 * 2. The async task runner advances the run status from "running" to a terminal
 *    state (completed, failed, completed_with_errors) within a strict timeout
 * 3. The evalSuiteRun.completedAt field is set (the UI polls on this)
 * 4. The evalSuiteRun.metadata.progress reflects the final state
 * 5. Exactly 1 test case result exists (we ran with testCaseIds filter)
 *
 * Skipped when ANTHROPIC_API_KEY is not set.
 *
 * Timeout: 150 s (3 × the default SIMULATION_TIMEOUT_MS of 30 s we set below)
 * to give the async task time to complete even on slow CI.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import app from "@/app";
import { env } from "@/env";
import { forApp, forOrg } from "@db/rls";
import {
  agentSops,
  agents,
  connectorTools,
  connectors,
  connectorsCatalog,
  evalSuiteRuns,
  evalSuiteTestCases,
  organizations,
} from "@db/schema";
import { compileAgent } from "@features/compiler/compiler.service";
import { enqueueSimulateAndRun } from "@features/evals/eval-suites-simulate.service";
import {
  deleteEvalSuite,
  getEvalSuiteRunById,
  initSuiteFromSop,
} from "@features/evals/eval-suites.service";
import { createSop } from "@features/sops/sops.service";
import { eq } from "drizzle-orm";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// Shorten simulation timeout to surface hangs faster.
// The test timeout below is 3x this value.
const SIMULATION_TIMEOUT_MS = 30_000;
const SIMULATION_MAX_TURNS = 3;

// ============================================================================
// Ephemeral server (MastraAdapter → simulation MCP route)
// ============================================================================

// MastraAdapter makes real HTTP calls to /simulations/:sessionId/mcp.
// We start a local Bun server so it's reachable, then point API_EXTERNAL_ADDRESS at it.
const mcpServer = Bun.serve({ port: 0, fetch: app.fetch });
env.API_EXTERNAL_ADDRESS = `http://localhost:${mcpServer.port}`;
env.SIMULATION_TIMEOUT_MS = SIMULATION_TIMEOUT_MS;
env.SIMULATION_MAX_TURNS = SIMULATION_MAX_TURNS;

// ============================================================================
// Fixtures
// ============================================================================

interface Ctx {
  orgId: string;
  agentId: string;
  lookUpOrderToolId: string;
}

let ctx: Ctx;
let sopId: string;
let suiteId: string;
let firstTestCaseId: string;

beforeAll(async () => {
  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: "Eval Runner Single Case Test Org",
        slug: "eval-runner-single-case-test",
      })
      .returning();

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: org.id,
        name: "Single Case Test Agent",
        slug: "single-case-test-agent",
        modality: "text",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });

    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));

    const [storeConn] = await tx
      .insert(connectors)
      .values({
        organizationId: org.id,
        connectorCatalogId: medusa.id,
        name: "Single Case Store",
        slug: "single_store",
      })
      .returning({ id: connectors.id });

    const [lookUpTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: org.id,
        connectorId: storeConn.id,
        name: "Look Up Order",
        slug: "look_up_order",
      })
      .returning({ id: connectorTools.id });

    ctx = {
      orgId: org.id,
      agentId: agent.id,
      lookUpOrderToolId: lookUpTool.id,
    };
  });

  // Simple 2-step SOP: one tool call + one instruction.
  // Deliberately minimal to keep LLM calls fast and deterministic.
  const sop = await createSop(ctx.orgId, {
    name: "Single Case Order SOP",
    slug: "single-case-order-sop",
    definition: {
      schemaVersion: 1,
      trigger: { type: "manual", config: {} as Record<string, never> },
      steps: [
        {
          id: "lookup-order",
          order: 1,
          instruction:
            "Look up the order using the order ID from the customer message.",
          required: true,
          tool: { connectorToolId: ctx.lookUpOrderToolId },
        },
        {
          id: "reply-status",
          order: 2,
          instruction:
            "Reply with the order status and estimated delivery date.",
          required: true,
        },
      ],
      metadata: {},
    },
  });
  sopId = sop.id;

  await forApp((tx) =>
    tx.insert(agentSops).values({
      agentId: ctx.agentId,
      sopId: sop.id,
    }),
  );
});

afterAll(async () => {
  mcpServer?.stop();
  if (ctx?.orgId) {
    await forApp((tx) =>
      tx.delete(organizations).where(eq(organizations.id, ctx.orgId)),
    );
  }
});

// ============================================================================
// Tests
// ============================================================================

describe("eval runner — single test case", () => {
  it.skipIf(!HAS_API_KEY)(
    "run with one test case reaches a terminal state (no infinite loop)",
    async () => {
      // 1. Compile the agent so it has compiled_instructions
      await compileAgent({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        sopIds: [sopId],
      });

      // 2. Init the suite — creates auto evaluators from SOP steps
      const suite = await initSuiteFromSop(ctx.orgId, ctx.agentId, sopId);
      suiteId = suite.id;

      // 3. Pick the first (auto) test case and set its input
      const autoTc = suite.testCases.find((tc) => tc.source === "auto");
      expect(autoTc).toBeDefined();
      firstTestCaseId = autoTc!.id;

      await forOrg(ctx.orgId, (tx) =>
        tx
          .update(evalSuiteTestCases)
          .set({
            input: {
              message: "Hi, where is my order ORD-001?",
              // No persona — single-turn to keep it fast
            },
            mockToolResponses: {
              single_store_look_up_order: {
                order_id: "ORD-001",
                status: "shipped",
                shipping_date: "2026-04-10",
                estimated_delivery: "2026-04-15",
                carrier: "FedEx",
                tracking_number: "FX-00001",
              },
            },
          })
          .where(eq(evalSuiteTestCases.id, firstTestCaseId)),
      );

      // 4. Enqueue simulate-and-run for ONE test case only
      const result = await enqueueSimulateAndRun(
        ctx.orgId,
        suite.id,
        "compiled",
        { testCaseIds: [firstTestCaseId] },
      );
      expect(result.suiteRunId).toBeString();

      // 5. Poll for completion — max 75 iterations × 2 s = 150 s
      //    Log each step so the infinite loop location is visible in test output.
      let runDetail: Awaited<ReturnType<typeof getEvalSuiteRunById>> | null =
        null;
      let pollCount = 0;
      const maxPolls = 75;

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        pollCount = i + 1;

        runDetail = await getEvalSuiteRunById(
          ctx.orgId,
          suite.id,
          result.suiteRunId,
        );

        const meta = runDetail.metadata as {
          progress?: {
            completed: number;
            total: number;
            currentTestCase: string | null;
          };
        } | null;

        console.log(
          `[eval-runner poll ${pollCount}/${maxPolls}] ` +
            `status=${runDetail.status} ` +
            `completedAt=${runDetail.completedAt ?? "null"} ` +
            `progress=${JSON.stringify(meta?.progress ?? {})} ` +
            `testCaseResults=${runDetail.testCaseResults.length}`,
        );

        if (runDetail.status !== "running") {
          console.log(
            `[eval-runner] reached terminal state after ${pollCount} polls`,
          );
          break;
        }

        if (i === maxPolls - 1) {
          // About to exhaust polls — dump task runner state for diagnosis
          const rawRun = await forOrg(ctx.orgId, (tx) =>
            tx
              .select()
              .from(evalSuiteRuns)
              .where(eq(evalSuiteRuns.id, result.suiteRunId)),
          );
          console.error(
            "[eval-runner] STUCK — run never left 'running' state.",
            JSON.stringify(
              {
                suiteRunId: result.suiteRunId,
                rawRunStatus: rawRun[0]?.status,
                rawCompletedAt: rawRun[0]?.completedAt,
                metadata: rawRun[0]?.metadata,
              },
              null,
              2,
            ),
          );
        }
      }

      // 6. Assert: run must have reached a terminal state
      expect(
        runDetail?.status,
        `Run ${result.suiteRunId} never left 'running' after ${pollCount} polls`,
      ).not.toBe("running");

      // 7. completedAt must be set (this is what the UI polls on)
      expect(
        runDetail?.completedAt,
        "completedAt must be set for the UI to stop polling",
      ).not.toBeNull();

      // 8. Must have exactly 1 test case result (we filtered to 1 test case)
      expect(runDetail?.testCaseResults).toHaveLength(1);

      // 9. Progress metadata must show completed = total = 1
      const finalMeta = runDetail?.metadata as {
        progress?: {
          completed: number;
          total: number;
          currentTestCase: string | null;
        };
      } | null;
      expect(finalMeta?.progress?.total).toBe(1);
      expect(finalMeta?.progress?.completed).toBe(1);
      expect(finalMeta?.progress?.currentTestCase).toBeNull();

      // Cleanup
      await deleteEvalSuite(ctx.orgId, suiteId);
    },
    150_000, // 150 s test timeout (5× SIMULATION_TIMEOUT_MS)
  );

  it.skipIf(!HAS_API_KEY)(
    "eval suite run status transitions: running → terminal (no stuck 'running')",
    async () => {
      // Regression: verify that after enqueueSimulateAndRun the run status
      // is initially 'running' and eventually changes — never stays stuck.

      // Re-use compiled agent + suite from prior test if possible, else set up fresh
      await compileAgent({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        sopIds: [sopId],
      });

      const suite = await initSuiteFromSop(ctx.orgId, ctx.agentId, sopId);
      const autoTc = suite.testCases.find((tc) => tc.source === "auto");
      expect(autoTc).toBeDefined();

      await forOrg(ctx.orgId, (tx) =>
        tx
          .update(evalSuiteTestCases)
          .set({
            input: { message: "Hi, where is order ORD-002?" },
            mockToolResponses: {
              single_store_look_up_order: {
                order_id: "ORD-002",
                status: "delivered",
                shipping_date: "2026-04-08",
                estimated_delivery: "2026-04-12",
                carrier: "UPS",
                tracking_number: "UPS-00002",
              },
            },
          })
          .where(eq(evalSuiteTestCases.id, autoTc!.id)),
      );

      const result = await enqueueSimulateAndRun(
        ctx.orgId,
        suite.id,
        "compiled",
        { testCaseIds: [autoTc!.id] },
      );

      // Immediately after enqueue, status should be 'running' (not already completed)
      const immediate = await getEvalSuiteRunById(
        ctx.orgId,
        suite.id,
        result.suiteRunId,
      );
      expect(immediate.status).toBe("running");
      expect(immediate.completedAt).toBeNull();

      // Poll until done
      let final: Awaited<ReturnType<typeof getEvalSuiteRunById>> | null = null;
      for (let i = 0; i < 75; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        final = await getEvalSuiteRunById(
          ctx.orgId,
          suite.id,
          result.suiteRunId,
        );
        console.log(
          `[status-transition poll ${i + 1}] status=${final.status} completedAt=${final.completedAt ?? "null"}`,
        );
        if (final.status !== "running") break;
      }

      expect(final?.status).not.toBe("running");
      expect(final?.completedAt).not.toBeNull();

      await deleteEvalSuite(ctx.orgId, suite.id);
    },
    150_000,
  );
});
