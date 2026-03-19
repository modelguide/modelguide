/**
 * Appointment Booking E2E — validates the eval suite infrastructure
 * is SOP-agnostic by testing with a completely different SOP structure.
 *
 * initSuiteFromSop → compileAgent → runEvalSuite with appointment booking SOP.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { forApp } from "@db/rls";
import {
  agents,
  connectorTools,
  connectors,
  connectorsCatalog,
  organizations,
} from "@db/schema";
import { compileAgent } from "@features/compiler/compiler.service";
import {
  initSuiteFromSop,
  runEvalSuite,
} from "@features/evals/eval-suites.service";
import { storeSyntheticSession } from "@features/sessions/synthetic-session.service";
import { createSop } from "@features/sops/sops.service";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { eq } from "drizzle-orm";
import { z } from "zod";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// ============================================================================
// Fixture IDs
// ============================================================================

let orgId: string;
let agentId: string;
let checkAvailToolId: string;
let bookApptToolId: string;

beforeAll(async () => {
  await forApp(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: "Appointment E2E Test Org",
        slug: "appt-e2e-test",
      })
      .returning();

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: org.id,
        name: "Appointment Agent",
        slug: "appt-agent",
        modality: "voice",
        agentPlatform: "custom",
      })
      .returning({ id: agents.id });

    // Reuse medusa catalog entry for the connector (structure, not semantics)
    const [medusa] = await tx
      .select({ id: connectorsCatalog.id })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));

    const [schedulingConn] = await tx
      .insert(connectors)
      .values({
        organizationId: org.id,
        connectorCatalogId: medusa.id,
        name: "Scheduling",
        slug: "scheduling",
      })
      .returning({ id: connectors.id });

    const [checkTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: org.id,
        connectorId: schedulingConn.id,
        name: "Check Availability",
        slug: "check_availability",
      })
      .returning({ id: connectorTools.id });

    const [bookTool] = await tx
      .insert(connectorTools)
      .values({
        organizationId: org.id,
        connectorId: schedulingConn.id,
        name: "Book Appointment",
        slug: "book_appointment",
      })
      .returning({ id: connectorTools.id });

    orgId = org.id;
    agentId = agent.id;
    checkAvailToolId = checkTool.id;
    bookApptToolId = bookTool.id;
  });
});

afterAll(async () => {
  if (orgId) {
    await forApp((tx) =>
      tx.delete(organizations).where(eq(organizations.id, orgId)),
    );
  }
});

// ============================================================================
// Tests
// ============================================================================

describe("Appointment Booking E2E: second SOP dry run", () => {
  it.skipIf(!HAS_API_KEY)(
    "initSuiteFromSop → compileAgent → runEvalSuite with appointment SOP",
    async () => {
      // Given — create SOP with appointment-specific steps
      const sop = await createSop(orgId, {
        name: "Appt E2E Booking",
        slug: "appt-e2e-booking",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} as Record<string, never> },
          steps: [
            {
              id: "greet-caller",
              order: 1,
              instruction:
                "Greet the caller warmly and ask how you can help them today.",
              required: true,
            },
            {
              id: "collect-details",
              order: 2,
              instruction:
                "Ask the caller for their preferred date, time, and appointment type.",
              required: true,
            },
            {
              id: "check-availability",
              order: 3,
              instruction: "Check the calendar for available slots.",
              required: true,
              tool: { connectorToolId: checkAvailToolId },
            },
            {
              id: "book-appointment",
              order: 4,
              instruction: "Book the appointment in the selected time slot.",
              required: true,
              tool: { connectorToolId: bookApptToolId },
            },
            {
              id: "confirm-details",
              order: 5,
              instruction: "Confirm the booking details with the caller.",
              required: true,
            },
          ],
          metadata: {},
        },
      });

      // Step 1: initSuiteFromSop — auto-generates single test case with all evaluators
      const suite = await initSuiteFromSop(orgId, agentId, sop.id);

      expect(suite.testCases.length).toBe(1);
      const allEvaluators = suite.testCases.flatMap(
        (tc: { evaluators: unknown[] }) => tc.evaluators,
      );
      expect(allEvaluators.length).toBeGreaterThanOrEqual(3);

      // Step 2: compileAgent
      const compileResult = await compileAgent({
        orgId,
        agentId,
        sopId: sop.id,
        agentModel: "anthropic/claude-haiku-4-5-20251001",
        agentDescription:
          "You are a friendly receptionist handling appointment bookings over the phone.",
      });

      expect(compileResult.agent!.compiledInstructions).toBeTruthy();
      expect(compileResult.ir.tools.map((t) => t.resolvedName)).toEqual([
        "scheduling_check_availability",
        "scheduling_book_appointment",
      ]);

      // Step 3: Run agent with mocked tools and store session
      const mockTools = {
        scheduling_check_availability: createTool({
          id: "scheduling_check_availability",
          description: "Check calendar availability",
          inputSchema: z.object({
            date: z.string().optional(),
            time: z.string().optional(),
          }),
          outputSchema: z.record(z.unknown()),
          execute: async () => ({
            available: true,
            slots: ["10:00 AM", "2:00 PM", "4:30 PM"],
            date: "2026-03-25",
          }),
        }),
        scheduling_book_appointment: createTool({
          id: "scheduling_book_appointment",
          description: "Book an appointment",
          inputSchema: z.object({
            date: z.string().optional(),
            time: z.string().optional(),
            type: z.string().optional(),
            name: z.string().optional(),
          }),
          outputSchema: z.record(z.unknown()),
          execute: async () => ({
            confirmed: true,
            appointmentId: "APT-2026-001",
            date: "2026-03-25",
            time: "10:00 AM",
          }),
        }),
      };

      const agent = new Agent({
        id: "appt-booking-test",
        name: "appt-booking-test",
        instructions: compileResult.agent!.compiledInstructions!,
        model: "anthropic/claude-haiku-4-5-20251001",
        tools: mockTools,
      });

      const prompt =
        "Hi, I'd like to book a dental checkup appointment for next Tuesday morning if possible.";
      const result = await agent.generate(prompt, { maxSteps: 5 });

      const session = await storeSyntheticSession({
        orgId,
        agentId,
        generationResult: result,
        userInput: prompt,
        channelType: "voice",
        userIdentifier: "appt-test@example.com",
      });

      // Step 4: runEvalSuite against the real session
      const suiteResult = await runEvalSuite(
        orgId,
        suite.id,
        session.id,
        "compiled",
      );

      // Verify suite run completed
      expect(suiteResult.suiteRun.id).toBeTruthy();
      expect(suiteResult.suiteRun.status).toBe("completed");
      expect(suiteResult.results.length).toBe(suite.testCases.length);

      // Verify each test case was actually evaluated
      for (const result of suiteResult.results) {
        expect(result.evalRunId).toBeTruthy();
        expect(result.passed).not.toBeNull();
        expect(result.scores.length).toBeGreaterThan(0);
      }

      // Verify at least some scores pass
      const allScores = suiteResult.results.flatMap((r) => r.scores);
      const passingScores = allScores.filter((s) => s.result === "pass");
      expect(passingScores.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
