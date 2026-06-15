/**
 * Integration tests for `GET /api/agents/me` — the runtime-prompt-fetch
 * endpoint used by the LiveKit POC agent (ADR-015) to pull its current
 * compiled instructions when a voice-test session is dispatched.
 *
 * The contract is intentionally narrow: an API key for an agent gets back
 * just enough identity + prompt to instantiate an LLM session, never any
 * platform secrets or unrelated org data.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agents } from "@db/schema";
import { eq } from "drizzle-orm";
import { type TestSeed, agentHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAgentHeaders: Record<string, string>;
let orgBAgentHeaders: Record<string, string>;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

const COMPILED_PROMPT =
  "You are Sam, the friendly support agent. Always greet by name.";

beforeAll(async () => {
  s = await getTestSeed();
  orgAAgentHeaders = await agentHeadersFor(s.orgAAgentId, s.orgA.id);
  orgBAgentHeaders = await agentHeadersFor(s.orgBAgentId, s.orgB.id);

  await forApp((tx) =>
    tx
      .update(agents)
      .set({
        compiledInstructions: COMPILED_PROMPT,
        compiledAt: new Date(),
      })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

afterAll(async () => {
  // Restore agent to a clean state so other test files don't inherit the
  // injected compiled prompt.
  await forApp((tx) =>
    tx
      .update(agents)
      .set({
        compiledInstructions: null,
        compiledAt: null,
      })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

describe("GET /api/agents/me", () => {
  test("returns the agent identified by the API key (200)", async () => {
    const response = await request("/api/agents/me", {
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.name).toBeDefined();
    expect(body.slug).toBeDefined();
    expect(body.modality).toBeDefined();
    expect(body.isActive).toBe(true);
  });

  test("includes the compiled instructions for prototype workers", async () => {
    const response = await request("/api/agents/me", {
      headers: orgAAgentHeaders,
    });

    const body = await response.json();
    expect(body.compiledInstructions).toBe(COMPILED_PROMPT);
    expect(body.compiledAt).toBeString();
  });

  test("never leaks platform secrets or hashed API keys", async () => {
    const response = await request("/api/agents/me", {
      headers: orgAAgentHeaders,
    });

    const body = await response.json();
    expect(body.secrets).toBeUndefined();
    expect(body.apiKey).toBeUndefined();
    expect(body.keyHash).toBeUndefined();
  });

  test("isolates agents across organizations (no cross-org leakage)", async () => {
    const response = await request("/api/agents/me", {
      headers: orgBAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(s.orgBAgentId);
    expect(body.id).not.toBe(s.orgAAgentId);
  });

  test("rejects unauthenticated requests (401)", async () => {
    const response = await request("/api/agents/me");
    expect(response.status).toBe(401);
  });

  test("rejects user JWTs — API key auth only (401)", async () => {
    // Importing here to avoid a top-level dep cycle in case the helpers
    // module ever reads env.
    const { authHeadersFor } = await import("../helpers/seed");
    const userHeaders = await authHeadersFor(s.orgAAdmin);

    const response = await request("/api/agents/me", {
      headers: userHeaders,
    });

    expect(response.status).toBe(401);
  });
});
