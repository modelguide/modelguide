/**
 * Runtime-config shape — the contract between a LiveKit worker (or any
 * external agent runtime) and the ModelGuide API.
 *
 * `GET /api/agents/me/runtime-config` returns this shape when a worker
 * authenticates with its agent API key. The worker uses it to materialize
 * the agent at session start (system prompt, filler phrases, language
 * rules) without redeploying when the prompt changes.
 *
 * `formatRuntimeConfig` is the pure projection that the route handler
 * calls. Locked behind unit tests because the worker has no type system
 * connection to MG — any drift here breaks every voice-test silently.
 */

import { describe, expect, test } from "bun:test";
import { formatRuntimeConfig } from "../../../src/features/agents/agents.service";

function makeAgentRow(
  over: Partial<Parameters<typeof formatRuntimeConfig>[0]> = {},
) {
  return {
    id: "agt_test_001",
    name: "Test Agent",
    slug: "test-agent",
    modality: "voice" as const,
    isActive: true,
    promptConfig: {},
    compiledInstructions: null,
    compiledAt: null,
    ...over,
  };
}

describe("formatRuntimeConfig", () => {
  test("returns the seven runtime fields a worker needs and nothing else", () => {
    const out = formatRuntimeConfig(makeAgentRow());
    expect(Object.keys(out).sort()).toEqual(
      [
        "id",
        "name",
        "slug",
        "modality",
        "isActive",
        "instructions",
        "promptConfig",
        "compiledAt",
      ].sort(),
    );
  });

  test("renames compiledInstructions → instructions for downstream simplicity", () => {
    // Workers refer to `instructions` (LiveKit Agent SDK term). Keep the
    // boundary mapping in one place so the worker can stay verbatim.
    const out = formatRuntimeConfig(
      makeAgentRow({
        compiledInstructions: "You are Sam, a helpful assistant.",
      }),
    );
    expect(out.instructions).toBe("You are Sam, a helpful assistant.");
  });

  test("instructions is null when the prompt was never compiled", () => {
    const out = formatRuntimeConfig(
      makeAgentRow({ compiledInstructions: null }),
    );
    expect(out.instructions).toBeNull();
  });

  test("preserves promptConfig as-is (persona, language, filler phrases)", () => {
    const cfg = {
      persona: "Friendly contractor supply rep.",
      language: "English only.",
      fillerPhrases: ["One moment.", "Let me check."],
    };
    const out = formatRuntimeConfig(makeAgentRow({ promptConfig: cfg }));
    expect(out.promptConfig).toEqual(cfg);
  });

  test("treats null promptConfig as empty object — never null on the wire", () => {
    // Workers parse the field unconditionally; nulls force every caller to
    // null-check. Empty object collapses the branch.
    const out = formatRuntimeConfig(
      makeAgentRow({ promptConfig: null as never }),
    );
    expect(out.promptConfig).toEqual({});
  });

  test("compiledAt is ISO string when set, null otherwise", () => {
    const when = new Date("2026-06-09T12:00:00.000Z");
    const compiled = formatRuntimeConfig(makeAgentRow({ compiledAt: when }));
    expect(compiled.compiledAt).toBe("2026-06-09T12:00:00.000Z");

    const empty = formatRuntimeConfig(makeAgentRow({ compiledAt: null }));
    expect(empty.compiledAt).toBeNull();
  });

  test("never leaks platform secrets or webhook metadata", () => {
    const row = makeAgentRow();
    (row as Record<string, unknown>).secrets = {
      livekit_api_secret: "secret-id",
      platform_api_key: "another-secret",
    };
    (row as Record<string, unknown>).metadata = {
      livekit: { url: "wss://internal" },
      webhook_hmac_secret: "shhh",
    };
    const out = formatRuntimeConfig(row);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/hmac/i);
    expect(serialized).not.toMatch(/livekit/i);
  });

  test("round-trips through JSON without dropping fields", () => {
    // The wire is JSON. Confirm nothing in the projection is a Symbol,
    // function, or other unserializable value.
    const out = formatRuntimeConfig(
      makeAgentRow({
        compiledInstructions: "x",
        compiledAt: new Date("2026-01-01T00:00:00.000Z"),
        promptConfig: { persona: "p" },
      }),
    );
    const round = JSON.parse(JSON.stringify(out));
    expect(round).toEqual(out);
  });
});
