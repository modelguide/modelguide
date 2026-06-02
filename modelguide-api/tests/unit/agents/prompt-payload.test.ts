/**
 * Prompt payload builder — locks in the shape returned by
 * `GET /api/agents/me/prompt`. A LiveKit (or any other) worker authenticates
 * with its agent API key and fetches this payload at session start so the
 * latest compiled prompt is applied without a redeploy.
 *
 * The fetch is on the hot path of every voice-test "Talk to agent" click, so
 * a drift between this shape and what the Python prototype expects (see
 * `examples/agents/livekit-prototype/src/prompt_fetcher.py`) silently breaks
 * the loop. There is no type system bridging the two — this test IS the
 * contract.
 */

import { describe, expect, test } from "bun:test";
import { buildAgentPromptPayload } from "../../../src/features/agents/prompt-payload";

const FROZEN_DATE = new Date("2026-05-01T12:34:56.000Z");

function fakeAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: "22222222-2222-2222-2222-222222222222",
    slug: "glowbox-concierge",
    name: "GlowBox Concierge",
    modality: "voice",
    promptConfig: {
      persona: "Friendly concierge.",
      language: "English",
      fillerPhrases: ["One moment."],
    },
    compiledInstructions: "You are Sam, the GlowBox concierge.",
    compiledAt: FROZEN_DATE,
    ...overrides,
  };
}

describe("buildAgentPromptPayload", () => {
  test("returns the compiled prompt and prompt config alongside agent identity", () => {
    const payload = buildAgentPromptPayload(fakeAgent());

    expect(payload).toEqual({
      agent: {
        id: "11111111-1111-1111-1111-111111111111",
        slug: "glowbox-concierge",
        name: "GlowBox Concierge",
        modality: "voice",
      },
      compiledInstructions: "You are Sam, the GlowBox concierge.",
      compiledAt: FROZEN_DATE.toISOString(),
      promptConfig: {
        persona: "Friendly concierge.",
        language: "English",
        fillerPhrases: ["One moment."],
      },
    });
  });

  test("nulls out compiledInstructions + compiledAt when the agent has never been compiled", () => {
    // The Python prototype branches on `compiledInstructions === null` to fall
    // back to a built-in placeholder prompt — so the null must survive the
    // shape, not collapse to undefined or an empty string.
    const payload = buildAgentPromptPayload(
      fakeAgent({ compiledInstructions: null, compiledAt: null }),
    );
    expect(payload.compiledInstructions).toBeNull();
    expect(payload.compiledAt).toBeNull();
  });

  test("defaults promptConfig to {} when the agent row has no config", () => {
    // Worker reads promptConfig.persona / .language with optional chaining,
    // but a missing field on the response body confuses downstream JSON
    // schema validators. Always emit an object.
    const payload = buildAgentPromptPayload(
      fakeAgent({ promptConfig: undefined }),
    );
    expect(payload.promptConfig).toEqual({});
  });

  test("never leaks the API-key hash, secrets map, or compiledFrom internals", () => {
    // Defense in depth: the agent row is wide. If a careless refactor ever
    // spreads the whole row into the payload, we want this test to scream.
    const wide = {
      ...fakeAgent(),
      // Fields a worker should never receive over the wire.
      secrets: { api_key: "00000000-0000-0000-0000-000000000099" },
      metadata: { livekit: { url: "wss://x" } },
      compiledFrom: { sops: [], guardrailIds: [], toolCount: 0 },
    };
    const payload = buildAgentPromptPayload(wide) as unknown as Record<
      string,
      unknown
    >;

    expect(payload.secrets).toBeUndefined();
    expect(payload.metadata).toBeUndefined();
    expect(payload.compiledFrom).toBeUndefined();
    expect(payload.organizationId).toBeUndefined();
  });

  test("preserves verbatim slug — workers route on string equality", () => {
    const payload = buildAgentPromptPayload(
      fakeAgent({ slug: "Weird_Slug-v1" }),
    );
    expect(payload.agent.slug).toBe("Weird_Slug-v1");
  });
});
