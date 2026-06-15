/**
 * Locks the response shape of `GET /api/agents/me` (ADR-015).
 *
 * The LiveKit POC agent in `examples/agents/livekit-poc-agent` reads this
 * payload at boot to render itself as the right MG agent and pick up the
 * latest compiled prompt. If a field drifts here, the prototype falls back
 * to its stub prompt with no warning — so the contract is pinned by this
 * test rather than living implicitly in the route handler.
 *
 * The complement to this test is the integration suite in
 * `tests/integration/agents-me.test.ts`, which covers auth + DB round-trip.
 */

import { describe, expect, test } from "bun:test";
import type { Agent } from "@db/schema";
import { formatAgentMe } from "../../../src/features/agents/agents.routes";

function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: "22222222-2222-2222-2222-222222222222",
    name: "Sam",
    slug: "buildpro_sam",
    description: "Contractor supply support agent",
    modality: "voice",
    modelFamily: "gpt",
    agentPlatform: "livekit",
    promptConfig: {
      persona: "Sharp, efficient supply rep",
      language: "en-US",
    },
    metadata: { livekit: { url: "wss://example.livekit.cloud" } },
    secrets: { livekit_api_key: "secret-uuid-here" },
    compiledInstructions: "Speak warmly. Greet by name.",
    compiledAt: new Date("2026-01-15T12:00:00Z"),
    compiledFrom: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: null,
    ...overrides,
  } as Agent;
}

describe("formatAgentMe", () => {
  test("returns the identity + compiled prompt the worker needs", () => {
    const result = formatAgentMe(fakeAgent());

    expect(result.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.name).toBe("Sam");
    expect(result.slug).toBe("buildpro_sam");
    expect(result.modality).toBe("voice");
    expect(result.modelFamily).toBe("gpt");
    expect(result.agentPlatform).toBe("livekit");
    expect(result.compiledInstructions).toBe("Speak warmly. Greet by name.");
    expect(result.isActive).toBe(true);
  });

  test("ISO-encodes compiledAt so the worker can parse it deterministically", () => {
    const result = formatAgentMe(fakeAgent());
    // The worker parses this with Python's datetime.fromisoformat — must be
    // a real ISO 8601 string, not a Date instance / undefined.
    expect(result.compiledAt).toBe("2026-01-15T12:00:00.000Z");
  });

  test("collapses missing compiled state to null (worker falls back to stub)", () => {
    const result = formatAgentMe(
      fakeAgent({ compiledInstructions: null, compiledAt: null }),
    );
    expect(result.compiledInstructions).toBeNull();
    expect(result.compiledAt).toBeNull();
  });

  test("does not leak platform secrets, integration URLs, or org ID", () => {
    // These would all be problematic to expose to a runtime worker:
    //   - `secrets` is the encrypted-vault ref map; even refs are sensitive
    //     because they reveal which platform creds an agent has provisioned.
    //   - `organizationId` would let a compromised key escalate from
    //     "agent" to "org-wide" if other endpoints ever leak by orgId.
    //   - `metadata` contains LiveKit/ElevenLabs URLs + webhook secrets.
    const result = formatAgentMe(fakeAgent()) as Record<string, unknown>;

    expect(result.secrets).toBeUndefined();
    expect(result.organizationId).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.integrationUrls).toBeUndefined();
    expect(result.apiKey).toBeUndefined();
  });

  test("preserves the promptConfig blob verbatim (no field drop)", () => {
    // promptConfig is the editable input; the worker re-renders it for
    // diagnostics. Drop a field here and persona edits silently stop
    // showing in the prototype dashboard.
    const result = formatAgentMe(fakeAgent());
    expect(result.promptConfig).toEqual({
      persona: "Sharp, efficient supply rep",
      language: "en-US",
    });
  });

  test("shape is stable — exactly these 11 keys", () => {
    // If a new field shows up here, the Python client in
    // `examples/agents/livekit-poc-agent/src/mg_client.py` either needs
    // an explicit update or it will silently ignore the field.
    const result = formatAgentMe(fakeAgent());
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "name",
        "slug",
        "description",
        "modality",
        "modelFamily",
        "agentPlatform",
        "promptConfig",
        "compiledInstructions",
        "compiledAt",
        "isActive",
      ].sort(),
    );
  });

  test("round-trips through JSON.stringify without losing fields", () => {
    // The handler does `c.json(formatAgentMe(agent))`, which is structurally
    // equivalent to JSON.stringify. Guard against anyone sneaking a Date
    // or BigInt into the projection.
    const result = formatAgentMe(fakeAgent());
    const round = JSON.parse(JSON.stringify(result));
    expect(round).toEqual(result);
  });
});
