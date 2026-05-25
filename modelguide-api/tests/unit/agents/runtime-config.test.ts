/**
 * Runtime config — the shape returned by `GET /agents/me/runtime-config`,
 * which the POC LiveKit worker fetches on every voice-test session to pick
 * up the dashboard's latest compiled prompt without redeploying.
 *
 * `formatAgentRuntimeConfig` is the pure helper that builds the payload from
 * a loaded agent row. Locking the shape with a unit test means a refactor
 * that drops/renames a field is caught at CI rather than at "the agent
 * silently uses an empty prompt and the call goes silent."
 *
 * See ADR-015 for the worker-fetches-prompt rationale.
 */

import { describe, expect, test } from "bun:test";
import type { Agent } from "../../../src/db/schema";
import { formatAgentRuntimeConfig } from "../../../src/features/agents/runtime-config";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  // Minimal fixture — we only assert the fields the runtime config emits.
  return {
    id: "00000000-0000-0000-0000-000000000001",
    organizationId: "00000000-0000-0000-0000-0000000000ff",
    name: "Test Agent",
    slug: "test-agent",
    description: null,
    modality: "voice",
    modelFamily: "gpt",
    promptConfig: {},
    agentPlatform: "livekit",
    metadata: {},
    secrets: {},
    isActive: true,
    compiledInstructions: null,
    compiledAt: null,
    compiledFrom: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-02T00:00:00Z"),
    createdBy: null,
    ...overrides,
  } as unknown as Agent;
}

describe("formatAgentRuntimeConfig", () => {
  test("exposes the fields a LiveKit worker needs to boot a session", () => {
    const cfg = formatAgentRuntimeConfig(
      makeAgent({
        id: "11111111-1111-1111-1111-111111111111",
        name: "Glowbox Voice",
        slug: "glowbox-voice",
        modality: "voice",
        compiledInstructions: "You are Sam. Be helpful.",
        compiledAt: new Date("2026-05-20T12:00:00Z"),
        promptConfig: { persona: "Sam", language: "en-US" },
      }),
    );

    expect(cfg.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(cfg.name).toBe("Glowbox Voice");
    expect(cfg.slug).toBe("glowbox-voice");
    expect(cfg.modality).toBe("voice");
    expect(cfg.compiledInstructions).toBe("You are Sam. Be helpful.");
    expect(cfg.compiledAt).toBe("2026-05-20T12:00:00.000Z");
    expect(cfg.promptConfig).toEqual({ persona: "Sam", language: "en-US" });
  });

  test("emits null/empty when the agent has never been compiled", () => {
    // Worker must tolerate this — operator hasn't hit Compile yet.
    const cfg = formatAgentRuntimeConfig(
      makeAgent({ compiledInstructions: null, compiledAt: null }),
    );
    expect(cfg.compiledInstructions).toBeNull();
    expect(cfg.compiledAt).toBeNull();
  });

  test("promptConfig defaults to {} when not set (never undefined)", () => {
    // The worker reads .persona / .language defensively; an undefined object
    // would force every caller to guard. We normalize to {}.
    // Cast through unknown so a future schema tightening doesn't allow null
    // here without us re-deciding what to emit.
    const cfg = formatAgentRuntimeConfig(
      makeAgent({ promptConfig: null as unknown as Agent["promptConfig"] }),
    );
    expect(cfg.promptConfig).toEqual({});
  });

  test("never leaks secrets, api keys, or org id", () => {
    // The agent's own API key authenticates this call. We deliberately keep
    // the response narrow so a misconfigured worker can't echo sensitive
    // material into a log or trace.
    const cfg = formatAgentRuntimeConfig(
      makeAgent({
        secrets: { livekit_api_key: "sec-1", platform_api_key: "sec-2" },
        metadata: { webhook_hmac_secret: "shhh", livekit: { url: "wss://x" } },
        organizationId: "00000000-0000-0000-0000-0000000000ff",
      }),
    );
    const json = JSON.stringify(cfg);
    expect(json).not.toContain("sec-1");
    expect(json).not.toContain("sec-2");
    expect(json).not.toContain("shhh");
    expect(json).not.toContain("0000000000ff");
    // Defensive on field names too — a future "include everything" refactor
    // should fail this test, not silently leak.
    expect((cfg as unknown as Record<string, unknown>).secrets).toBeUndefined();
    expect(
      (cfg as unknown as Record<string, unknown>).organizationId,
    ).toBeUndefined();
    expect(
      (cfg as unknown as Record<string, unknown>).metadata,
    ).toBeUndefined();
  });

  test("round-trips through JSON without dropping fields", () => {
    // The worker fetches this over HTTP; non-serializable values would
    // explode at .json() instead of returning a useful error.
    const cfg = formatAgentRuntimeConfig(
      makeAgent({
        compiledInstructions: "instructions",
        compiledAt: new Date("2026-05-20T12:00:00Z"),
      }),
    );
    expect(JSON.parse(JSON.stringify(cfg))).toEqual(cfg);
  });
});
