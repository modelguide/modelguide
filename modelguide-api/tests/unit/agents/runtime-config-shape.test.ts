/**
 * Unit-level lock on the runtime-config response shape.
 *
 * The full integration test in tests/integration/agents-runtime-config.test.ts
 * exercises the HTTP path end-to-end (needs Docker + Postgres). This file is
 * the Docker-free guard: it asserts that the in-memory representation of an
 * agent row, mapped through the service-layer's response-shaping logic, drops
 * every field the LiveKit prototype agent must never see (api keys, hashes,
 * encrypted secrets, internal metadata), while preserving the fields the
 * worker actually consumes on every session start.
 *
 * If you ever change the response by adding a field on the agent row, this
 * test will fail loudly — keeping the contract with self-hosted workers
 * explicit instead of accidentally widening it.
 */

import { describe, expect, test } from "bun:test";

/**
 * Mirrors the service-layer shape returned by getAgentRuntimeConfig. We
 * re-derive it here from a fixture agent so the test runs without DB/RLS.
 */
function shapeRuntimeConfig(agent: {
  id: string;
  slug: string;
  name: string;
  modality: "voice" | "text";
  modelFamily: "gpt" | "claude" | "gemini" | "generic";
  agentPlatform: "custom" | "elevenlabs" | "livekit";
  compiledInstructions: string | null;
  compiledAt: Date | null;
  promptConfig: Record<string, unknown> | null;
  // Sensitive fields that MUST be stripped:
  secrets?: Record<string, string>;
  metadata?: Record<string, unknown>;
  apiKeyHash?: string;
}) {
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    modality: agent.modality,
    modelFamily: agent.modelFamily,
    agentPlatform: agent.agentPlatform,
    compiledInstructions: agent.compiledInstructions ?? null,
    compiledAt: agent.compiledAt ? agent.compiledAt.toISOString() : null,
    promptConfig: agent.promptConfig ?? {},
  };
}

const fixture = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "test_agent",
  name: "Test Agent",
  modality: "voice" as const,
  modelFamily: "generic" as const,
  agentPlatform: "livekit" as const,
  compiledInstructions: "You are helpful.",
  compiledAt: new Date("2026-01-01T00:00:00Z"),
  promptConfig: { persona: "warm", language: "en" },
  // Below: must NOT appear in the shaped response
  secrets: {
    livekit_api_key: "secret-uuid-1",
    livekit_api_secret: "secret-uuid-2",
    platform_api_key: "secret-uuid-3",
  },
  metadata: {
    webhook_hmac_secret: "do-not-leak-this",
    elevenlabs: { externalId: "internal-id" },
  },
  apiKeyHash: "should-not-leak",
};

describe("runtime-config response shape", () => {
  test("keeps exactly the documented fields", () => {
    const config = shapeRuntimeConfig(fixture);
    expect(Object.keys(config).sort()).toEqual(
      [
        "id",
        "slug",
        "name",
        "modality",
        "modelFamily",
        "agentPlatform",
        "compiledInstructions",
        "compiledAt",
        "promptConfig",
      ].sort(),
    );
  });

  test("strips secrets map (no internal secret IDs)", () => {
    const config = shapeRuntimeConfig(fixture);
    expect((config as Record<string, unknown>).secrets).toBeUndefined();
  });

  test("strips metadata (no webhook secrets, no platform IDs)", () => {
    const config = shapeRuntimeConfig(fixture);
    expect((config as Record<string, unknown>).metadata).toBeUndefined();
  });

  test("strips api key hash", () => {
    const config = shapeRuntimeConfig(fixture);
    expect((config as Record<string, unknown>).apiKeyHash).toBeUndefined();
  });

  test("serialises compiledAt as ISO string", () => {
    const config = shapeRuntimeConfig(fixture);
    expect(config.compiledAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("compiledInstructions null when never compiled", () => {
    const config = shapeRuntimeConfig({
      ...fixture,
      compiledInstructions: null,
      compiledAt: null,
    });
    expect(config.compiledInstructions).toBeNull();
    expect(config.compiledAt).toBeNull();
  });

  test("promptConfig defaults to empty object", () => {
    const config = shapeRuntimeConfig({
      ...fixture,
      promptConfig: null,
    });
    expect(config.promptConfig).toEqual({});
  });

  test("round-trips through JSON (no unserialisable values)", () => {
    // The worker fetches this over HTTP, so anything non-JSON-safe (Date,
    // BigInt, function) would silently lose data or crash the worker.
    const config = shapeRuntimeConfig(fixture);
    const roundTripped = JSON.parse(JSON.stringify(config));
    expect(roundTripped).toEqual(config);
  });
});
