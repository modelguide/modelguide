/**
 * Runtime-config shape — locks the wire format that voice workers consume.
 *
 * The LiveKit prototype agent (examples/agents/livekit-prototype-agent) hits
 * `GET /api/agents/me` at session start and reads `compiledInstructions` to
 * build its system prompt. The field names and nullability are part of an
 * implicit contract across the TS/Python boundary — this test pins them.
 */

import { describe, expect, test } from "bun:test";
import { formatAgentRuntimeConfig } from "../../../src/features/agents/agents.service";

const baseAgent = {
  id: "00000000-0000-0000-0000-0000000000aa",
  organizationId: "00000000-0000-0000-0000-0000000000b0",
  name: "Sam",
  slug: "buildpro-sam",
  description: null,
  modality: "voice" as const,
  modelFamily: "gpt" as const,
  promptConfig: { persona: "Friendly contractor supply assistant" },
  agentPlatform: "livekit" as const,
  isActive: true,
  createdBy: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  metadata: {
    livekit: { url: "wss://x.livekit.cloud", agentName: "buildpro" },
    webhook_hmac_secret: "should-not-leak",
  },
  secrets: { livekit_api_key: "00000000-0000-0000-0000-0000000000c0" },
  compiledInstructions: "You are Sam.",
  compiledAt: new Date("2026-02-01T00:00:00.000Z"),
  compiledFrom: null,
  updatedAt: null,
};

describe("formatAgentRuntimeConfig", () => {
  test("returns identity + compiled prompt fields the worker reads", () => {
    const cfg = formatAgentRuntimeConfig(baseAgent);
    expect(cfg.id).toBe(baseAgent.id);
    expect(cfg.slug).toBe("buildpro-sam");
    expect(cfg.name).toBe("Sam");
    expect(cfg.modality).toBe("voice");
    expect(cfg.modelFamily).toBe("gpt");
    expect(cfg.agentPlatform).toBe("livekit");
    expect(cfg.compiledInstructions).toBe("You are Sam.");
    expect(cfg.compiledAt).toBe("2026-02-01T00:00:00.000Z");
  });

  test("returns the persona under promptConfig so the worker can build a greeting", () => {
    const cfg = formatAgentRuntimeConfig(baseAgent);
    expect(cfg.promptConfig).toEqual({
      persona: "Friendly contractor supply assistant",
    });
  });

  test("nulls compiledInstructions / compiledAt when the agent was never compiled", () => {
    const cfg = formatAgentRuntimeConfig({
      ...baseAgent,
      compiledInstructions: null,
      compiledAt: null,
    });
    expect(cfg.compiledInstructions).toBeNull();
    expect(cfg.compiledAt).toBeNull();
  });

  test("strips webhook_hmac_secret from metadata so it can't leak via /me", () => {
    const cfg = formatAgentRuntimeConfig(baseAgent);
    const stringified = JSON.stringify(cfg);
    expect(stringified).not.toContain("webhook_hmac_secret");
    expect(stringified).not.toContain("should-not-leak");
  });

  test("strips agent secrets map (only refs, but keep it off the wire anyway)", () => {
    const cfg = formatAgentRuntimeConfig(baseAgent) as Record<string, unknown>;
    // Secrets are stored as encrypted refs by ID on the agent row, never as
    // plaintext credentials, so leaking the map IDs isn't catastrophic — but
    // the runtime-config endpoint has no need for them, so they must not be
    // in the response.
    expect("secrets" in cfg).toBe(false);
  });

  test("passes through livekit metadata so the worker can sanity-check its own agentName", () => {
    const cfg = formatAgentRuntimeConfig(baseAgent);
    const metadata = cfg.metadata as Record<string, unknown> | undefined;
    expect(metadata).toBeDefined();
    expect((metadata?.livekit as Record<string, unknown>).agentName).toBe(
      "buildpro",
    );
  });

  test("response shape is stable — keys are exactly the documented set", () => {
    // If anyone adds a new field, they have to update this list AND the
    // Python prototype agent's expectations, AND the ADR. Drift-prevention.
    const cfg = formatAgentRuntimeConfig(baseAgent) as Record<string, unknown>;
    expect(Object.keys(cfg).sort()).toEqual(
      [
        "agentPlatform",
        "compiledAt",
        "compiledInstructions",
        "id",
        "isActive",
        "metadata",
        "modality",
        "modelFamily",
        "name",
        "promptConfig",
        "slug",
        "updatedAt",
      ].sort(),
    );
  });
});
