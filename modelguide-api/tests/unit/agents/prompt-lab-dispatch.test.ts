/**
 * Prompt Lab dispatch metadata — contract lock for the prompt-override path.
 *
 * This is the POC extension of ADR-014 documented in ADR-015. Where the
 * standard voice-test path forbids prompt injection, the Prompt Lab opts
 * in by sending `prompt_override` in the dispatch metadata so the worker
 * uses the editor's prompt verbatim for that single session.
 *
 * If `prompt_override` is renamed, dropped, or silently truncated by the
 * helper, the worker stops honoring the override and the lab silently
 * tests the baked-in profile prompt instead — exactly the failure mode
 * ADR-014 warned about, but invisible. This file is the contract.
 */

import { describe, expect, test } from "bun:test";
import {
  PROMPT_LAB_MAX_BYTES,
  buildVoiceTestDispatchMetadata,
} from "../../../src/features/agents/agents.service";

describe("buildVoiceTestDispatchMetadata — prompt override", () => {
  test("omits prompt_override when no override is supplied (back-compat)", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect("prompt_override" in md).toBe(false);
  });

  test("includes prompt_override verbatim when supplied", () => {
    const prompt = "You are a pirate. Answer in pirate.";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      promptOverride: prompt,
    });
    expect(md.prompt_override).toBe(prompt);
  });

  test("preserves multi-line / unicode / emoji prompts byte-for-byte", () => {
    const prompt = "Line 1\nLine 2 — ünicode\n\t• indented 🦜\n";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      promptOverride: prompt,
    });
    expect(md.prompt_override).toBe(prompt);
  });

  test("throws when promptOverride exceeds the byte cap", () => {
    const tooBig = "a".repeat(PROMPT_LAB_MAX_BYTES + 1);
    expect(() =>
      buildVoiceTestDispatchMetadata({
        agentSlug: "x",
        sessionId: "s",
        callerEmail: "c@e.com",
        promptOverride: tooBig,
      }),
    ).toThrow(/prompt/i);
  });

  test("accepts a prompt at the exact byte cap", () => {
    const justRight = "a".repeat(PROMPT_LAB_MAX_BYTES);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      promptOverride: justRight,
    });
    expect(md.prompt_override?.length).toBe(PROMPT_LAB_MAX_BYTES);
  });

  test("byte cap counts UTF-8 bytes, not JS string length", () => {
    // A 4-byte UTF-8 code point (🦜) used to fill exactly past the cap.
    // 1 emoji = 4 bytes in UTF-8 but 2 UTF-16 code units in a JS string.
    // We want to make sure we reject on bytes, not on string length, so the
    // worker's metadata cap (which LiveKit measures in bytes) holds.
    const emoji = "🦜"; // 4 bytes
    const count = Math.floor(PROMPT_LAB_MAX_BYTES / 4) + 1;
    const tooBig = emoji.repeat(count);
    expect(Buffer.byteLength(tooBig, "utf8")).toBeGreaterThan(
      PROMPT_LAB_MAX_BYTES,
    );
    expect(() =>
      buildVoiceTestDispatchMetadata({
        agentSlug: "x",
        sessionId: "s",
        callerEmail: "c@e.com",
        promptOverride: tooBig,
      }),
    ).toThrow(/prompt/i);
  });

  test("rejects empty / whitespace-only overrides", () => {
    // An empty override would silently fall through to the worker's baked-in
    // profile prompt — confusing for the operator who thinks they're testing
    // their edit. Surface it as a validation error instead.
    for (const v of ["", "   ", "\n\n\t"]) {
      expect(() =>
        buildVoiceTestDispatchMetadata({
          agentSlug: "x",
          sessionId: "s",
          callerEmail: "c@e.com",
          promptOverride: v,
        }),
      ).toThrow(/prompt/i);
    }
  });

  test("the rest of the metadata shape is unchanged when override is set", () => {
    // Lock-in that adding promptOverride doesn't perturb the existing five
    // fields — the worker's routing on `agentName` must keep working.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "agent_slug_v1",
      sessionId: "sess-123",
      callerEmail: "lab@corp.com",
      promptOverride: "hi",
    });
    expect(md.mode).toBe("voice-test");
    expect(md.agentName).toBe("agent_slug_v1");
    expect(md.session_id).toBe("sess-123");
    expect(md.user_identifier).toBe("lab@corp.com");
    expect(md.email).toBe("lab@corp.com");
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "email",
        "mode",
        "prompt_override",
        "session_id",
        "user_identifier",
      ].sort(),
    );
  });

  test("round-trips through JSON without dropping prompt_override", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      promptOverride: "carry me through JSON.stringify cleanly",
    });
    expect(JSON.parse(JSON.stringify(md))).toEqual(md);
  });
});
