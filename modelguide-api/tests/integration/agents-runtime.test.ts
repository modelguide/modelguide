/**
 * Integration tests for the agent-runtime endpoint.
 *
 * GET /api/agents/me/runtime returns the runtime config that a deployed
 * voice/text worker (e.g. the LiveKit agent in
 * `examples/agents/livekit-agent/`) needs to bring up an LLM session against
 * the latest compiled prompt — without baking the prompt into the worker
 * image. Auth is the agent's own `mgk_` API key, so the worker doesn't need
 * to know its own UUID or the org it belongs to.
 *
 * See docs/decisions/006-livekit-runtime-prompt-fetch.md for rationale.
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
let orgBAgentHeaders: Record<string, string>;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgAAgentHeaders = await agentHeadersFor(s.orgAAgentId, s.orgA.id);
  orgBAgentHeaders = await agentHeadersFor(s.orgBAgentId, s.orgB.id);

  // Stamp a deterministic compiled prompt + promptConfig on orgA's agent so
  // the response shape assertions don't depend on whatever the seed compiler
  // last produced.
  await forApp((tx) =>
    tx
      .update(agents)
      .set({
        compiledInstructions: "You are Sam, a helpful contractor supply agent.",
        compiledAt: new Date("2026-01-01T00:00:00Z"),
        promptConfig: {
          persona: "Sam — friendly, fast",
          language: "English (US)",
          fillerPhrases: ["one moment", "let me check"],
        },
      })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

afterAll(async () => {
  // Restore the agent so other suites that depend on the seed see its
  // original state. We don't keep a snapshot — clearing is sufficient because
  // `getTestSeed()` is read-only beyond the column resets we do here.
  await forApp((tx) =>
    tx
      .update(agents)
      .set({
        compiledInstructions: null,
        compiledAt: null,
        promptConfig: {},
      })
      .where(eq(agents.id, s.orgAAgentId)),
  );
});

describe("GET /api/agents/me/runtime", () => {
  test("returns the calling agent's runtime config (200)", async () => {
    const response = await request("/api/agents/me/runtime", {
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.organizationId).toBe(s.orgA.id);
    expect(body.name).toBeDefined();
    expect(body.slug).toBeDefined();
    expect(body.modality).toBeDefined();
    expect(body.agentPlatform).toBeDefined();
    expect(body.compiledInstructions).toBe(
      "You are Sam, a helpful contractor supply agent.",
    );
    expect(body.compiledAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.promptConfig.persona).toBe("Sam — friendly, fast");
    expect(body.promptConfig.language).toBe("English (US)");
    expect(body.promptConfig.fillerPhrases).toEqual([
      "one moment",
      "let me check",
    ]);
  });

  test("rejects user (cookie/JWT) auth — agent API key only (401)", async () => {
    // The point of this endpoint is to identify the caller as an agent worker.
    // A dashboard JWT carries no agent identity, so requireAgent() should bounce it.
    const response = await request("/api/agents/me/runtime", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(401);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/agents/me/runtime");
    expect(response.status).toBe(401);
  });

  test("returns the right agent when keys from different orgs are presented", async () => {
    // Each API key uniquely identifies its agent — orgB's key must never
    // surface orgA's compiled prompt (RLS leak guard).
    const responseA = await request("/api/agents/me/runtime", {
      headers: orgAAgentHeaders,
    });
    const bodyA = await responseA.json();

    const responseB = await request("/api/agents/me/runtime", {
      headers: orgBAgentHeaders,
    });
    const bodyB = await responseB.json();

    expect(bodyA.id).toBe(s.orgAAgentId);
    expect(bodyB.id).toBe(s.orgBAgentId);
    expect(bodyA.organizationId).not.toBe(bodyB.organizationId);
  });

  test("returns null compiledInstructions before the agent is compiled", async () => {
    // Worker should be able to see a null prompt and fall back gracefully
    // instead of receiving a 404 — a brand-new agent that hasn't been
    // compiled yet is still a legitimate runtime target.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({ compiledInstructions: null, compiledAt: null })
        .where(eq(agents.id, s.orgBAgentId)),
    );

    const response = await request("/api/agents/me/runtime", {
      headers: orgBAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.compiledInstructions).toBeNull();
    expect(body.compiledAt).toBeNull();
  });
});
