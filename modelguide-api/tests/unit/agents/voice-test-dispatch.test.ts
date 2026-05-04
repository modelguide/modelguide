/**
 * Voice-test dispatch metadata — locks in the MG-agent-slug ↔ worker-profile
 * coupling. The LiveKit worker's entrypoint reads `agentName` from the
 * JSON metadata blob to pick a profile from its registry (see
 * `examples/agents/livekit-agent/src/agent.py` — looks up `agentName` and
 * also reads the optional `compiledInstructions` override).
 *
 * If the field name or shape ever drifts, every dispatched call goes
 * silent at the worker. There's no type system connecting the two sides,
 * so this test IS the contract.
 *
 * `compiledInstructions` was added in ADR-015 to support "compile → click →
 * talk" voice testing. The size cap and "drop instead of fail" semantics
 * are part of that contract: a too-large prompt MUST NOT crash dispatch —
 * it falls back to the worker's baked prompt with the field absent.
 */

import { describe, expect, test } from "bun:test";
import {
  COMPILED_INSTRUCTIONS_MAX_CHARS,
  buildVoiceTestDispatchMetadata,
} from "../../../src/features/agents/agents.service";

describe("buildVoiceTestDispatchMetadata", () => {
  test("carries agentName = agent.slug for multi-profile routing", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "banknowa_v1",
      sessionId: "sess-abc",
      callerEmail: "admin@example.com",
    });
    // The single most important field — workers route on this.
    expect(md.agentName).toBe("banknowa_v1");
  });

  test("mode is a literal 'voice-test' marker", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(md.mode).toBe("voice-test");
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "tenant_a",
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("baseline shape — exactly these 5 keys when no compiled prompt is supplied", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(Object.keys(md).sort()).toEqual(
      ["agentName", "email", "mode", "session_id", "user_identifier"].sort(),
    );
  });

  test("agentSlug is echoed verbatim — no mutation", () => {
    // Guard against a well-meaning refactor that lowercases/trims the slug
    // "to match a worker convention". The worker matches on exact string
    // equality, so any transform silently breaks routing.
    const weird = "Weird_Slug-v1";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: weird,
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(md.agentName).toBe(weird);
  });

  test("round-trips through JSON without dropping fields", () => {
    // The dispatch layer JSON-stringifies this payload. Confirm nothing is
    // a Symbol, function, or other unserializable value.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "banknowa_v2",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: "You are a helpful agent.\nBe concise.",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });

  // ------------------------------------------------------------------
  // ADR-015: compiledInstructions override
  // ------------------------------------------------------------------

  test("includes compiledInstructions when caller supplies it", () => {
    // The worker reads this exact key (camelCase) and uses it as the
    // system prompt over the baked-in profile prompt.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "tenant_a",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: "You are Sam. Be helpful.",
    });
    expect(md.compiledInstructions).toBe("You are Sam. Be helpful.");
  });

  test("omits compiledInstructions when caller passes null/undefined/empty", () => {
    // null = no compiled prompt yet on the agent → worker uses baked
    // profile prompt → key MUST be absent (not "" — the worker treats
    // empty-string as a cleared override).
    for (const value of [null, undefined, ""] as const) {
      const md = buildVoiceTestDispatchMetadata({
        agentSlug: "x",
        sessionId: "s",
        callerEmail: "c@e.com",
        compiledInstructions: value,
      });
      expect("compiledInstructions" in md).toBe(false);
    }
  });

  test("drops compiledInstructions when it exceeds the byte cap", () => {
    // Hard guard: dispatch metadata is JSON-stringified into LiveKit's
    // server SDK and there's a server-side cap on metadata size. A
    // misbehaving 500K-char prompt MUST NOT crash dispatch — drop the
    // override and let the worker fall back to the baked prompt.
    const tooLong = "x".repeat(COMPILED_INSTRUCTIONS_MAX_CHARS + 1);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: tooLong,
    });
    expect("compiledInstructions" in md).toBe(false);
  });

  test("keeps compiledInstructions when it sits exactly at the cap", () => {
    // Boundary: ≤ cap is included, > cap is dropped. An off-by-one here
    // causes silent prompt loss in production.
    const atCap = "y".repeat(COMPILED_INSTRUCTIONS_MAX_CHARS);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: atCap,
    });
    expect(md.compiledInstructions).toBe(atCap);
  });

  test("cap is documented at a sane value (10K-100K chars)", () => {
    // Sanity-check the constant. Too low (<10K) and real prompts get
    // truncated. Too high (>100K) and a single voice-test could exceed
    // LiveKit's metadata size cap and break dispatch.
    expect(COMPILED_INSTRUCTIONS_MAX_CHARS).toBeGreaterThanOrEqual(10_000);
    expect(COMPILED_INSTRUCTIONS_MAX_CHARS).toBeLessThanOrEqual(100_000);
  });
});
