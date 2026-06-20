/**
 * Voice-test dispatch metadata — locks in the MG-agent-slug ↔ worker-profile
 * coupling. The LiveKit worker's entrypoint reads `agentName` from the
 * JSON metadata blob to pick a profile from its registry (see
 * `demos/bank-nowa/voice-agent/src/agent.py`:
 *
 *     agent_name = dispatch_metadata.get("agentName")
 *     if not agent_name or agent_name not in _clients: ...
 *
 * If the field name or shape ever drifts, every dispatched call goes
 * silent at the worker. There's no type system connecting the two sides,
 * so this test IS the contract.
 */

import { describe, expect, test } from "bun:test";
import { buildVoiceTestDispatchMetadata } from "../../../src/features/agents/agents.service";

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

  test("shape is stable — exactly these 5 keys, nothing else", () => {
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
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });
});

/**
 * POC extension (see ADR-015): when a `compiledInstructions` string is
 * provided, dispatch metadata carries it through as `instructions` so an
 * opt-in worker (the livekit-poc prototype) can pick up the latest compiled
 * prompt without a worker redeploy. ADR-014 deliberately left this off for
 * production workers — the POC pattern is opt-in on the worker side: workers
 * that ignore the field behave exactly as before.
 *
 * These tests pin the contract on the API half. The Python half lives in
 * `examples/agents/livekit-poc/tests/test_prompt_resolution.py`.
 */
describe("buildVoiceTestDispatchMetadata — compiled instructions (POC)", () => {
  test("omits `instructions` when no compiledInstructions provided", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    // Strict absence — not "instructions: undefined" — so JSON.stringify
    // doesn't accidentally encode it for a worker that would then read it
    // as the literal string "undefined" on the Python side.
    expect("instructions" in md).toBe(false);
  });

  test("carries `instructions` verbatim when compiledInstructions provided", () => {
    const compiled = "You are Sam, a friendly contractor supply assistant.";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: compiled,
    });
    expect(md.instructions).toBe(compiled);
  });

  test("omits `instructions` for empty string (treats empty as absent)", () => {
    // An empty compiled prompt is meaningless to the worker and would
    // override the worker's baked-in default with nothing. Treat it the
    // same as "not provided" so the worker's default still wins.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: "",
    });
    expect("instructions" in md).toBe(false);
  });

  test("omits `instructions` for whitespace-only string", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: "   \n\t  ",
    });
    expect("instructions" in md).toBe(false);
  });

  test("preserves the other five keys when instructions is added", () => {
    // Regression guard: the original 5-key shape must remain intact.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "tenant_a",
      sessionId: "sess-1",
      callerEmail: "c@e.com",
      compiledInstructions: "Be helpful.",
    });
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "email",
        "instructions",
        "mode",
        "session_id",
        "user_identifier",
      ].sort(),
    );
  });

  test("survives JSON round-trip with a long prompt", () => {
    // ADR-014 cited a 50K char cap for prompt-in-metadata; the LiveKit
    // dispatch metadata cap is 48KB. Keep the test prompt well below both
    // so it asserts the encoding round-trip without testing the cap itself
    // (the cap is enforced upstream in createVoiceTestSession).
    const prompt = "You are a helpful assistant.\n".repeat(200); // ~6KB
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: prompt,
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped.instructions).toBe(prompt);
  });
});
