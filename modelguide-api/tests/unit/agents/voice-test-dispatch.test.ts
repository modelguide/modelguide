/**
 * Voice-test dispatch metadata — locks in the MG-agent-slug ↔ worker-profile
 * coupling. The LiveKit worker's entrypoint reads `agentName` from the
 * JSON metadata blob to pick a profile from its registry (see
 * `examples/agents/livekit-agent/src/agent.py`:
 *
 *     agent_name = dispatch_metadata.get("agentName")
 *
 * If the field name or shape ever drifts, every dispatched call goes
 * silent at the worker. There's no type system connecting the two sides,
 * so this test IS the contract.
 *
 * The same contract also covers the optional `instructions` override
 * (POC: edit prompt → compile → talk). When MG ships a compiled prompt,
 * the worker overrides its baked-in profile prompt with the one from
 * metadata. See ADR-015.
 */

import { describe, expect, test } from "bun:test";
import {
  VOICE_TEST_INSTRUCTIONS_MAX_BYTES,
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

  test("shape is stable — exactly the 5 required keys when no instructions", () => {
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

  // ----------------------------------------------------------------------
  // Compiled-prompt override (ADR-015)
  //
  // The worker's MCPAgent base reads ``dispatch_metadata.get("instructions")``
  // and uses it instead of the baked profile prompt when present. This is
  // what lets the dashboard "Compile" + "Talk to agent" cycle test the
  // *latest* prompt without redeploying the worker.
  // ----------------------------------------------------------------------

  test("includes `instructions` when a compiled prompt is provided", () => {
    const compiled = "You are Sam, the BuildPro assistant. Be brief.";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: compiled,
    });
    expect(md.instructions).toBe(compiled);
  });

  test("omits `instructions` when no compiled prompt is provided", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect("instructions" in md).toBe(false);
  });

  test("omits `instructions` when an explicit null is provided", () => {
    // compiledInstructions is `text | null` in the DB — null and "no prompt
    // configured" must behave identically so the worker falls back to its
    // baked profile prompt.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: null,
    });
    expect("instructions" in md).toBe(false);
  });

  test("omits `instructions` when an empty/whitespace prompt is provided", () => {
    // A compiled prompt that's just whitespace would silently break the
    // agent — fall back to the baked profile prompt instead.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "   \n\t  ",
    });
    expect("instructions" in md).toBe(false);
  });

  test("omits `instructions` when the prompt exceeds the LiveKit metadata size guard", () => {
    // LiveKit dispatch metadata is JSON-stringified and sent over the
    // control channel. Practical payloads should stay well under ~32KB
    // to avoid hitting platform limits and TLS-fragmenting the dispatch
    // RPC. If a compiled prompt is too big, drop it from metadata so the
    // call still goes through with the baked prompt (we'd rather hear
    // the *previous* prompt than no audio at all).
    const oversized = "x".repeat(VOICE_TEST_INSTRUCTIONS_MAX_BYTES + 1);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: oversized,
    });
    expect("instructions" in md).toBe(false);
  });

  test("keeps `instructions` exactly at the size boundary", () => {
    const atLimit = "x".repeat(VOICE_TEST_INSTRUCTIONS_MAX_BYTES);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: atLimit,
    });
    expect(md.instructions).toBe(atLimit);
  });

  test("sizes by byte length, not character count (handles multibyte)", () => {
    // A naive .length check passes a string of "🚀" — each emoji is a
    // 2-char surrogate pair in JS but 4 bytes on the wire — that's under
    // .length=32k but well over 32KB once JSON.stringify'd. Pick a count
    // that's deliberately small in JS char terms but oversized in UTF-8.
    const fourByteEmoji = "🚀";
    const repeats = 10_000; // length=20k chars, bytes=40k → triggers guard
    const multibyte = fourByteEmoji.repeat(repeats);
    expect(multibyte.length).toBeLessThan(VOICE_TEST_INSTRUCTIONS_MAX_BYTES);
    expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(
      VOICE_TEST_INSTRUCTIONS_MAX_BYTES,
    );

    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: multibyte,
    });
    expect("instructions" in md).toBe(false);
  });

  test("instructions field round-trips cleanly through JSON.stringify", () => {
    // The dispatch layer JSON.stringify's the whole metadata. Verify
    // that newlines, quotes, and unicode in a compiled prompt survive.
    const prompt = 'You are "Sam". Greet the user with: \n"Hi! 👋"';
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "buildpro_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: prompt,
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped.instructions).toBe(prompt);
  });
});
