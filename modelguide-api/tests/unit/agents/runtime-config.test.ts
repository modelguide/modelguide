/**
 * Runtime-config response builder — locks in the wire format the LiveKit
 * prototype worker (and any future runtime that pulls latest prompt at
 * session start) reads from `GET /api/agents/me/runtime-config`.
 *
 * If the field names ever drift, deployed agents start crashing at session
 * start with KeyError on missing keys. There's no type system spanning the
 * Bun API and the Python worker, so this test IS the contract.
 */

import { describe, expect, test } from "bun:test";
import { buildRuntimeConfig } from "../../../src/features/agents/agents.service";

const baseAgent = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "support-voice",
  name: "Support Voice",
  modality: "voice",
  modelFamily: "gpt",
  compiledInstructions: "You are a helpful assistant.",
  compiledAt: new Date("2026-03-01T10:00:00.000Z"),
};

describe("buildRuntimeConfig", () => {
  test("returns exactly the keys the worker consumes — no more, no less", () => {
    const cfg = buildRuntimeConfig(baseAgent);
    expect(Object.keys(cfg).sort()).toEqual(
      [
        "agentId",
        "compiledAt",
        "compiledInstructions",
        "modality",
        "modelFamily",
        "name",
        "slug",
      ].sort(),
    );
  });

  test("agentId mirrors the agent row's id (workers join sessions on it)", () => {
    expect(buildRuntimeConfig(baseAgent).agentId).toBe(baseAgent.id);
  });

  test("compiled prompt is echoed verbatim — no trimming, no escaping", () => {
    const weird = 'Hello\nWorld\t"quoted" — em-dash';
    const cfg = buildRuntimeConfig({
      ...baseAgent,
      compiledInstructions: weird,
    });
    expect(cfg.compiledInstructions).toBe(weird);
  });

  test("compiledAt is serialized as ISO-8601 UTC", () => {
    const cfg = buildRuntimeConfig(baseAgent);
    expect(cfg.compiledAt).toBe("2026-03-01T10:00:00.000Z");
  });

  test("null compiled fields pass through — uncompiled agents return 200", () => {
    // The worker treats null as "no remote prompt yet — fall back to local
    // default". Returning {} or omitting the keys would break the JSON shape
    // and crash strict parsers.
    const cfg = buildRuntimeConfig({
      ...baseAgent,
      compiledInstructions: null,
      compiledAt: null,
    });
    expect(cfg.compiledInstructions).toBeNull();
    expect(cfg.compiledAt).toBeNull();
  });

  test("round-trips through JSON without dropping fields", () => {
    const cfg = buildRuntimeConfig(baseAgent);
    const roundTripped = JSON.parse(JSON.stringify(cfg));
    expect(roundTripped).toEqual(cfg);
  });
});
