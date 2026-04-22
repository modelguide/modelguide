/**
 * Voice-test POC dispatch metadata — the prompt-injection variant.
 *
 * Unlike the production voice-test path (see `voice-test-dispatch.test.ts`)
 * which deliberately does NOT inject a prompt, this POC path carries a
 * freshly compiled prompt in dispatch metadata so an admin can iterate on
 * prompts in the UI and hear the result without redeploying the worker.
 *
 * The worker entrypoint reads `mode === "voice-test-poc"` to switch on this
 * behaviour — if the field name, shape, or mode marker drifts, the worker
 * silently falls back to its baked-in prompt. There's no type system
 * connecting the two sides, so this test IS the contract.
 *
 * See ADR-015.
 */

import { describe, expect, test } from "bun:test";
import {
  VOICE_TEST_POC_MAX_PROMPT_BYTES,
  buildVoiceTestPocDispatchMetadata,
} from "../../../src/features/agents/agents.service";

describe("buildVoiceTestPocDispatchMetadata", () => {
  const base = {
    agentSlug: "banknowa_v1",
    sessionId: "sess-abc",
    callerEmail: "admin@example.com",
    compiledInstructions: "You are a helpful voice agent. Be concise.",
  };

  test("mode is the literal 'voice-test-poc' marker (distinguishes from prod path)", () => {
    const md = buildVoiceTestPocDispatchMetadata(base);
    expect(md.mode).toBe("voice-test-poc");
  });

  test("carries agentName = agent.slug for multi-profile routing", () => {
    const md = buildVoiceTestPocDispatchMetadata(base);
    expect(md.agentName).toBe("banknowa_v1");
  });

  test("carries compiled_instructions verbatim (byte-for-byte)", () => {
    const prompt = "First line.\n\n# Heading\n- bullet\n- another\n\nEnd.";
    const md = buildVoiceTestPocDispatchMetadata({
      ...base,
      compiledInstructions: prompt,
    });
    expect(md.compiled_instructions).toBe(prompt);
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildVoiceTestPocDispatchMetadata({
      ...base,
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("shape is stable — exactly these 6 keys, nothing else", () => {
    const md = buildVoiceTestPocDispatchMetadata(base);
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "compiled_instructions",
        "email",
        "mode",
        "session_id",
        "user_identifier",
      ].sort(),
    );
  });

  test("agentSlug is echoed verbatim — no mutation", () => {
    // Same guard as the prod path: the worker matches on exact string
    // equality for profile lookup.
    const weird = "Weird_Slug-v1";
    const md = buildVoiceTestPocDispatchMetadata({ ...base, agentSlug: weird });
    expect(md.agentName).toBe(weird);
  });

  test("round-trips through JSON without dropping fields", () => {
    const md = buildVoiceTestPocDispatchMetadata(base);
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });

  test("rejects empty / whitespace-only compiled prompt — worker would silently fall back", () => {
    // We do NOT want "submitted an empty override, silently used baked prompt"
    // to be a valid outcome. If the caller asked for POC mode, they must
    // provide an actual prompt.
    expect(() =>
      buildVoiceTestPocDispatchMetadata({ ...base, compiledInstructions: "" }),
    ).toThrow(/compiled prompt/i);
    expect(() =>
      buildVoiceTestPocDispatchMetadata({
        ...base,
        compiledInstructions: "   \n\t ",
      }),
    ).toThrow(/compiled prompt/i);
  });

  test("rejects prompts larger than VOICE_TEST_POC_MAX_PROMPT_BYTES (UTF-8 byte length)", () => {
    // LiveKit dispatch metadata is capped at ~48KB total. We enforce 32KB on
    // the prompt alone to leave headroom for the rest of the JSON envelope
    // plus LiveKit's own framing.
    expect(VOICE_TEST_POC_MAX_PROMPT_BYTES).toBe(32 * 1024);

    const oversized = "x".repeat(VOICE_TEST_POC_MAX_PROMPT_BYTES + 1);
    expect(() =>
      buildVoiceTestPocDispatchMetadata({
        ...base,
        compiledInstructions: oversized,
      }),
    ).toThrow(/too large|too big|exceeds/i);
  });

  test("measures size by UTF-8 bytes, not JS chars (multibyte safety)", () => {
    // 🚀 is 4 bytes in UTF-8. A prompt that's under the char limit but over
    // the byte limit must still be rejected — otherwise LiveKit dispatch
    // silently truncates the metadata and the worker sees a mangled prompt.
    const fourByteChar = "🚀";
    // One byte under the byte limit means 8K 🚀 chars (32KB) is fine but
    // 8K + 1 should be rejected.
    const justOver = fourByteChar.repeat(
      VOICE_TEST_POC_MAX_PROMPT_BYTES / 4 + 1,
    );
    expect(Buffer.byteLength(justOver, "utf8")).toBeGreaterThan(
      VOICE_TEST_POC_MAX_PROMPT_BYTES,
    );
    expect(() =>
      buildVoiceTestPocDispatchMetadata({
        ...base,
        compiledInstructions: justOver,
      }),
    ).toThrow(/too large|too big|exceeds/i);
  });

  test("accepts prompts at exactly the byte limit", () => {
    const atLimit = "a".repeat(VOICE_TEST_POC_MAX_PROMPT_BYTES);
    const md = buildVoiceTestPocDispatchMetadata({
      ...base,
      compiledInstructions: atLimit,
    });
    expect(md.compiled_instructions.length).toBe(
      VOICE_TEST_POC_MAX_PROMPT_BYTES,
    );
  });
});
