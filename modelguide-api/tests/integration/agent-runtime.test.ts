/**
 * Integration tests for GET /api/agents/me/runtime
 *
 * This endpoint is the single source of truth a runtime voice agent
 * (e.g. the voiceblox prototype in examples/agents/voiceblox-agent) calls
 * on session start to fetch the latest compiled system prompt + identity.
 *
 * The shape is part of the contract between the API and any external
 * runtime, so this test locks it in.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agents } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgAAgentHeaders: Record<string, string>;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgAAgentHeaders = await agentHeadersFor(s.orgAAgentId, s.orgA.id);

  // Activate the seeded agent and give it a compiled prompt so we can
  // assert the runtime endpoint exposes both.
  await request(`/api/agents/${s.orgAAgentId}/activate`, {
    method: "POST",
    headers: orgAAdminHeaders,
  });

  await forApp((tx) =>
    tx
      .update(agents)
      .set({
        compiledInstructions:
          "You are Sam, a friendly voice concierge. Speak warmly.",
        compiledAt: new Date("2026-01-01T00:00:00Z"),
      })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

afterAll(async () => {
  await forApp((tx) =>
    tx
      .update(agents)
      .set({ compiledInstructions: null, compiledAt: null })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

describe("GET /api/agents/me/runtime", () => {
  test("returns the agent's identity + compiled prompt (200)", async () => {
    const response = await request("/api/agents/me/runtime", {
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.name).toBeDefined();
    expect(body.slug).toBeDefined();
    expect(body.modality).toBeDefined();
    expect(body.agentPlatform).toBeDefined();
    expect(body.compiledInstructions).toBe(
      "You are Sam, a friendly voice concierge. Speak warmly.",
    );
    expect(body.compiledAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("rejects requests without auth (401)", async () => {
    const response = await request("/api/agents/me/runtime");
    expect(response.status).toBe(401);
  });

  test("rejects requests with user JWT auth — agent key required (401)", async () => {
    // The runtime endpoint must NEVER be reachable via a user JWT — that
    // would let any admin pull instructions for *any* agent in their org
    // with a single token. Only the agent's own API key may call it.
    const response = await request("/api/agents/me/runtime", {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(401);
  });

  test("returns null compiled fields when the agent has no compiled prompt", async () => {
    // Temporarily clear the compiled fields to verify nullability.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({ compiledInstructions: null, compiledAt: null })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const response = await request("/api/agents/me/runtime", {
      headers: orgAAgentHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.compiledInstructions).toBeNull();
    expect(body.compiledAt).toBeNull();

    // Restore for any subsequent test in this file.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions:
            "You are Sam, a friendly voice concierge. Speak warmly.",
          compiledAt: new Date("2026-01-01T00:00:00Z"),
        })
        .where(eq(agents.id, s.orgAAgentId)),
    );
  });

  test("never exposes secret refs or webhook config in the runtime payload", async () => {
    // Defence in depth: the runtime payload is consumed by a remote agent
    // process and may end up in logs/traces. Make sure we never leak
    // anything sensitive (secret IDs, internal webhook URLs, etc.).
    const response = await request("/api/agents/me/runtime", {
      headers: orgAAgentHeaders,
    });
    const body = await response.json();

    expect(body.secrets).toBeUndefined();
    expect(body.integrationUrls).toBeUndefined();
    expect(body.hasElevenLabsKey).toBeUndefined();
    expect(body.apiKey).toBeUndefined();
  });
});
