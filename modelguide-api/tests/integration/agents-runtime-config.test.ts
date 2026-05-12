/**
 * Integration tests for GET /api/agents/runtime-config
 *
 * This endpoint is consumed by self-hosted voice/chat agent workers (e.g. the
 * LiveKit prototype agent) to fetch their latest compiled prompt + minimal
 * runtime configuration at the start of every session. The worker authenticates
 * with its scoped API key (mgk_xxx) so the endpoint does not take an agent
 * ID — the agent is derived from the auth context.
 *
 * Contract (locked in by these tests):
 *   - Auth: Bearer mgk_xxx (agent API key). User JWT must be rejected.
 *   - 200 response includes:
 *       id, slug, name, modality, modelFamily, agentPlatform,
 *       compiledInstructions (nullable string),
 *       compiledAt (nullable ISO string),
 *       promptConfig (object — persona, fillerPhrases, language)
 *   - The response always reflects the *latest* compiled prompt — i.e. updates
 *     to the agent row are visible on the next call (no caching at the API
 *     layer).
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
  [orgAAdminHeaders, orgAAgentHeaders, orgBAgentHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
    agentHeadersFor(s.orgBAgentId, s.orgB.id),
  ]);
});

afterAll(async () => {
  // Restore agent rows to a clean state — other tests may rely on null
  // compiledInstructions.
  await forApp(async (tx) => {
    await tx
      .update(agents)
      .set({ compiledInstructions: null, compiledAt: null })
      .where(eq(agents.id, s.orgAAgentId));
  });
});

describe("GET /api/agents/runtime-config", () => {
  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/agents/runtime-config");
    expect(response.status).toBe(401);
  });

  test("rejects user JWT (must be agent API key) (401)", async () => {
    const response = await request("/api/agents/runtime-config", {
      headers: orgAAdminHeaders,
    });
    // User auth is not acceptable — this endpoint is only callable by agents.
    expect(response.status).toBe(401);
  });

  test("returns runtime config for the authenticated agent (200)", async () => {
    // Seed a compiled prompt so the test asserts a non-null value.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions: "You are a helpful test agent.",
          compiledAt: new Date(),
        })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const response = await request("/api/agents/runtime-config", {
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.slug).toBeString();
    expect(body.name).toBeString();
    expect(body.modality).toBeOneOf(["voice", "text"]);
    expect(body.modelFamily).toBeString();
    expect(body.agentPlatform).toBeOneOf(["custom", "elevenlabs", "livekit"]);
    expect(body.compiledInstructions).toBe("You are a helpful test agent.");
    expect(body.compiledAt).toBeString();
    expect(body.promptConfig).toBeObject();
  });

  test("returns the LATEST compiled prompt (no stale cache)", async () => {
    // Two reads must reflect two different writes. Locks in that the endpoint
    // reads from the agent row on every call — the LiveKit worker relies on
    // this to pick up a freshly-compiled prompt without any redeploy.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions: "first prompt",
          compiledAt: new Date(),
        })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const r1 = await request("/api/agents/runtime-config", {
      headers: orgAAgentHeaders,
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.compiledInstructions).toBe("first prompt");

    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions: "second prompt",
          compiledAt: new Date(),
        })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const r2 = await request("/api/agents/runtime-config", {
      headers: orgAAgentHeaders,
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.compiledInstructions).toBe("second prompt");
  });

  test("returns null compiledInstructions when agent has never been compiled", async () => {
    await forApp((tx) =>
      tx
        .update(agents)
        .set({ compiledInstructions: null, compiledAt: null })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const response = await request("/api/agents/runtime-config", {
      headers: orgAAgentHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.compiledInstructions).toBeNull();
    expect(body.compiledAt).toBeNull();
  });

  test("each agent only sees its own runtime config (RLS isolation)", async () => {
    // Cross-org leak guard: orgB's agent must never see orgA's prompt — and
    // vice versa. Same endpoint, different bearer = different agent row.
    await forApp(async (tx) => {
      await tx
        .update(agents)
        .set({
          compiledInstructions: "ORG-A SECRET PROMPT",
          compiledAt: new Date(),
        })
        .where(eq(agents.id, s.orgAAgentId));
      await tx
        .update(agents)
        .set({
          compiledInstructions: "ORG-B SECRET PROMPT",
          compiledAt: new Date(),
        })
        .where(eq(agents.id, s.orgBAgentId));
    });

    const [ra, rb] = await Promise.all([
      request("/api/agents/runtime-config", { headers: orgAAgentHeaders }),
      request("/api/agents/runtime-config", { headers: orgBAgentHeaders }),
    ]);

    const [ba, bb] = await Promise.all([ra.json(), rb.json()]);
    expect(ba.id).toBe(s.orgAAgentId);
    expect(ba.compiledInstructions).toBe("ORG-A SECRET PROMPT");
    expect(bb.id).toBe(s.orgBAgentId);
    expect(bb.compiledInstructions).toBe("ORG-B SECRET PROMPT");
  });

  test("does not leak sensitive fields (secrets, apiKey, hashes)", async () => {
    const response = await request("/api/agents/runtime-config", {
      headers: orgAAgentHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    // None of these should ever flow back to the worker — the worker has its
    // API key already (it just used it) and the LiveKit creds live on the
    // server.
    expect(body.apiKey).toBeUndefined();
    expect(body.keyHash).toBeUndefined();
    expect(body.livekit_api_secret).toBeUndefined();
    if (body.secrets) {
      // The secrets map is { fieldName: secretId } — UUIDs, not values — but
      // the worker shouldn't need it. Belt-and-braces: assert no decrypted
      // value sneaks in.
      for (const v of Object.values(body.secrets)) {
        expect(typeof v).toBe("string");
        // Decrypted ElevenLabs / LiveKit keys are not UUIDs.
        expect((v as string).length).toBeLessThanOrEqual(64);
      }
    }
  });
});
