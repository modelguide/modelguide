/**
 * Integration tests for GET /api/agents/me/runtime-config
 *
 * Contract surfaced to LiveKit/voice workers: an agent can use its own
 * API key to fetch the latest compiled prompt + voice config from
 * ModelGuide on session start. This is what makes "compile in dashboard
 * → talk to the new prompt" work for the POC LiveKit agent —
 * see docs/decisions/015-livekit-runtime-prompt-fetch.md and
 * examples/agents/livekit-poc-agent.
 *
 * The endpoint is API-key-only (mgk_*) — user JWTs are rejected. The
 * response is intentionally narrow: the worker should not need to know
 * about secrets, integration URLs, or evaluation state.
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
let orgAAgentHeaders: Record<string, string>;
let orgAAdminHeaders: Record<string, string>;

const KNOWN_PROMPT = "You are a helpful demo voice agent.";

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAgentHeaders = await agentHeadersFor(s.orgAAgentId, s.orgA.id);
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);

  // Stamp a known compiled prompt on the seed agent so tests don't depend
  // on whatever the seed happens to compile.
  await forApp((tx) =>
    tx
      .update(agents)
      .set({
        compiledInstructions: KNOWN_PROMPT,
        compiledAt: new Date("2026-04-01T00:00:00Z"),
      })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

afterAll(async () => {
  // Restore: clear out the test-stamped fields.
  await forApp((tx) =>
    tx
      .update(agents)
      .set({ compiledInstructions: null, compiledAt: null })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

describe("GET /api/agents/me/runtime-config", () => {
  test("returns compiled prompt and identity for the API-key-bound agent (200)", async () => {
    const response = await request("/api/agents/me/runtime-config", {
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.name).toBeString();
    expect(body.slug).toBeString();
    expect(body.modality).toBe("voice");
    expect(body.compiledInstructions).toBe(KNOWN_PROMPT);
    expect(body.compiledAt).toBe("2026-04-01T00:00:00.000Z");
    expect(body.agentPlatform).toBeString();
    expect(body.isActive).toBe(true);
  });

  test("does not leak secrets, integrationUrls, or evalSuiteCount", async () => {
    // The runtime-config endpoint is intentionally narrower than the
    // dashboard's GET /api/agents/:id. A worker has no business seeing
    // secret refs or webhook URLs.
    const response = await request("/api/agents/me/runtime-config", {
      headers: orgAAgentHeaders,
    });
    const body = await response.json();

    expect(body.secrets).toBeUndefined();
    expect(body.integrationUrls).toBeUndefined();
    expect(body.evalSuiteCount).toBeUndefined();
    expect(body.keyPrefix).toBeUndefined();
    expect(body.hasElevenLabsKey).toBeUndefined();
    expect(body.hasWebhookSecret).toBeUndefined();
  });

  test("returns null compiledInstructions when the agent has not been compiled", async () => {
    // Clear the prompt for this test, then put it back so the rest of the
    // suite still sees KNOWN_PROMPT.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({ compiledInstructions: null, compiledAt: null })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const response = await request("/api/agents/me/runtime-config", {
      headers: orgAAgentHeaders,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.compiledInstructions).toBeNull();
    expect(body.compiledAt).toBeNull();

    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions: KNOWN_PROMPT,
          compiledAt: new Date("2026-04-01T00:00:00Z"),
        })
        .where(eq(agents.id, s.orgAAgentId)),
    );
  });

  test("rejects user JWT auth — agent API key only (401)", async () => {
    const response = await request("/api/agents/me/runtime-config", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(401);
  });

  test("rejects unauthenticated requests (401)", async () => {
    const response = await request("/api/agents/me/runtime-config");
    expect(response.status).toBe(401);
  });
});
