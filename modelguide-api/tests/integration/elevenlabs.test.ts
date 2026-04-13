/**
 * Integration tests for ElevenLabs-specific endpoints:
 *   GET  /api/agents/elevenlabs/models
 *   POST /api/agents/:id/elevenlabs
 *
 * The create endpoint tests cover guard conditions that do not require a real
 * ElevenLabs API connection (400 / 409). The happy path requires a live key
 * and is covered in manual/e2e testing.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agents } from "@db/schema";
import { eq } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;

const createdAgentIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgASupportHeaders = await authHeadersFor(s.orgASupport);
});

afterAll(async () => {
  if (createdAgentIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdAgentIds) {
        await tx.delete(agents).where(eq(agents.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/agents/elevenlabs/models
// ============================================================================

describe("GET /api/agents/elevenlabs/models", () => {
  test("returns 200 with grouped model list (no filter)", async () => {
    const response = await request("/api/agents/elevenlabs/models", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(4);

    const families = body.data.map((g: { family: string }) => g.family);
    expect(families).toContain("gpt");
    expect(families).toContain("claude");
    expect(families).toContain("gemini");
    expect(families).toContain("generic");

    // Each group has at least one model with id + label
    for (const group of body.data) {
      expect(group.family).toBeString();
      expect(group.models).toBeArray();
      expect(group.models.length).toBeGreaterThan(0);
      for (const model of group.models) {
        expect(model.id).toBeString();
        expect(model.label).toBeString();
      }
    }
  });

  test("filters by ?family=claude returns only claude models", async () => {
    const response = await request(
      "/api/agents/elevenlabs/models?family=claude",
      {
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].family).toBe("claude");

    const ids = body.data[0].models.map((m: { id: string }) => m.id);
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).not.toContain("gpt-4o");
  });

  test("filters by ?family=gpt returns only gpt models", async () => {
    const response = await request("/api/agents/elevenlabs/models?family=gpt", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].family).toBe("gpt");

    const ids = body.data[0].models.map((m: { id: string }) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4.1");
    expect(ids).not.toContain("claude-sonnet-4-5");
  });

  test("filters by ?family=generic returns all models combined", async () => {
    const response = await request(
      "/api/agents/elevenlabs/models?family=generic",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].family).toBe("generic");

    const ids = body.data[0].models.map((m: { id: string }) => m.id);
    // Should contain models from all families
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("grok-beta");
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/agents/elevenlabs/models");
    expect(response.status).toBe(401);
  });

  test("accessible by support role (200)", async () => {
    const response = await request("/api/agents/elevenlabs/models", {
      headers: orgASupportHeaders,
    });
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// POST /api/agents/:id/elevenlabs
// ============================================================================

describe("POST /api/agents/:id/elevenlabs", () => {
  let agentId: string;

  beforeAll(async () => {
    // Create a plain agent (no API key configured)
    const res = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "EL Create Test — No Key",
        agentPlatform: "elevenlabs",
      }),
    });
    const body = await res.json();
    agentId = body.id;
    createdAgentIds.push(agentId);
  });

  test("returns 400 when no ElevenLabs API key configured", async () => {
    const response = await request(`/api/agents/${agentId}/elevenlabs`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBeDefined();
  });

  test("returns 409 when agent already has an ElevenLabs agent ID", async () => {
    // Create an agent and manually set metadata.elevenlabs.agentId
    const createRes = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "EL Create Test — Already Has ID",
        agentPlatform: "elevenlabs",
        metadata: {
          elevenlabs: { agentId: "agent_existing123" },
        },
      }),
    });
    const created = await createRes.json();
    createdAgentIds.push(created.id);

    const response = await request(`/api/agents/${created.id}/elevenlabs`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBeDefined();
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/agents/${agentId}/elevenlabs`, {
      method: "POST",
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(403);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}/elevenlabs`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// PATCH /api/agents/:id — metadata.elevenlabs.llmModel (AC 23)
// ============================================================================

describe("PATCH /api/agents/:id — metadata.elevenlabs.llmModel", () => {
  let agentId: string;

  beforeAll(async () => {
    const res = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "LLM Model Metadata Test",
        agentPlatform: "elevenlabs",
      }),
    });
    const body = await res.json();
    agentId = body.id;
    createdAgentIds.push(agentId);
  });

  test("accepts metadata.elevenlabs.llmModel in PATCH body (200)", async () => {
    const response = await request(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        metadata: {
          elevenlabs: {
            llmModel: "claude-sonnet-4-5",
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.metadata?.elevenlabs?.llmModel).toBe("claude-sonnet-4-5");
  });

  test("llmModel is preserved on subsequent metadata updates", async () => {
    // Update with a different field — llmModel should still be there
    const getRes = await request(`/api/agents/${agentId}`, {
      headers: orgAAdminHeaders,
    });
    const current = await getRes.json();
    const currentEl = current.metadata?.elevenlabs ?? {};

    const response = await request(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        metadata: {
          ...current.metadata,
          elevenlabs: {
            ...currentEl,
            agentId: "agent_test_preserve",
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.metadata?.elevenlabs?.llmModel).toBe("claude-sonnet-4-5");
    expect(body.metadata?.elevenlabs?.agentId).toBe("agent_test_preserve");
  });
});
