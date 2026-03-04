/**
 * Integration tests for Persona Simulation API.
 *
 * Tests that require a real LLM API key are skipped unless
 * SIMULATION_LLM_API_KEY is set in the environment.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { env } from "@/env";
import { forApp } from "@db/rls";
import { sessions } from "@db/schema";
import { eq } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../../helpers/seed";

let s: TestSeed;
let adminHeaders: Record<string, string>;
let supportHeaders: Record<string, string>;

const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  [adminHeaders, supportHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    authHeadersFor(s.orgASupport),
  ]);
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdSessionIds) {
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/simulations/personas
// ============================================================================

describe("GET /api/simulations/personas", () => {
  test("returns all personas (200)", async () => {
    const response = await request("/api/simulations/personas", {
      headers: adminHeaders,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);

    const ids = body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain("polite-buyer");
    expect(ids).toContain("impatient-returner");
    expect(ids).toContain("confused-browser");

    // Each persona has required fields
    for (const persona of body.data) {
      expect(persona).toHaveProperty("id");
      expect(persona).toHaveProperty("name");
      expect(persona).toHaveProperty("description");
      expect(persona).toHaveProperty("traits");
      expect(persona.traits).toBeArray();
    }
  });

  test("requires authentication (401)", async () => {
    const response = await request("/api/simulations/personas");
    expect(response.status).toBe(401);
  });
});

// ============================================================================
// POST /api/simulations/run — validation
// ============================================================================

describe("POST /api/simulations/run — validation", () => {
  test("rejects non-admin users (403)", async () => {
    const response = await request("/api/simulations/run", {
      method: "POST",
      headers: {
        ...supportHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: s.orgAAgentId,
        personaId: "polite-buyer",
      }),
    });
    expect(response.status).toBe(403);
  });

  test("rejects invalid persona ID (404)", async () => {
    const response = await request("/api/simulations/run", {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: s.orgAAgentId,
        personaId: "nonexistent-persona",
      }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("PERSONA_NOT_FOUND");
  });

  test("rejects missing agentId (400)", async () => {
    const response = await request("/api/simulations/run", {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personaId: "polite-buyer",
      }),
    });
    expect(response.status).toBe(422);
  });

  test("rejects invalid agentId format (400)", async () => {
    const response = await request("/api/simulations/run", {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: "not-a-uuid",
        personaId: "polite-buyer",
      }),
    });
    expect(response.status).toBe(422);
  });

  test("rejects maxTurns > 50 (400)", async () => {
    const response = await request("/api/simulations/run", {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: s.orgAAgentId,
        personaId: "polite-buyer",
        maxTurns: 100,
      }),
    });
    expect(response.status).toBe(422);
  });

  test("returns 503 when LLM API key is not configured", async () => {
    // Only run if key is NOT set — otherwise this test doesn't apply
    if (env.SIMULATION_LLM_API_KEY) {
      return;
    }

    const response = await request("/api/simulations/run", {
      method: "POST",
      headers: {
        ...adminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: s.orgAAgentId,
        personaId: "polite-buyer",
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("SIMULATION_LLM_NOT_CONFIGURED");
  });
});

// ============================================================================
// POST /api/simulations/run — full simulation (requires LLM API key)
// ============================================================================

const hasLlmKey = !!process.env.SIMULATION_LLM_API_KEY;

describe.skipIf(!hasLlmKey)(
  "POST /api/simulations/run — full simulation",
  () => {
    test(
      "runs simulation and creates session with mode=simulation",
      { timeout: 300_000 },
      async () => {
        const response = await request("/api/simulations/run", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentId: s.orgAAgentId,
            personaId: "polite-buyer",
            maxTurns: 5,
          }),
        });
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body.sessionId).toBeDefined();
        expect(body.personaId).toBe("polite-buyer");
        expect(body.turnCount).toBeGreaterThan(0);
        expect(body.turnCount).toBeLessThanOrEqual(5);
        expect(["completed", "max_turns_reached"]).toContain(body.status);
        expect(body.durationMs).toBeGreaterThan(0);

        createdSessionIds.push(body.sessionId);

        // Verify session was created with simulation mode
        const [session] = await forApp(async (tx) =>
          tx.select().from(sessions).where(eq(sessions.id, body.sessionId)),
        );
        expect(session).toBeDefined();
        expect(session.mode).toBe("simulation");
        expect(session.channelType).toBe("api");
        expect(session.userIdentifier).toBe("simulation:polite-buyer");
      },
    );
  },
);
