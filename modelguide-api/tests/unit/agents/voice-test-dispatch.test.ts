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
import {
  VOICE_TEST_PREVIEW_MAX_BYTES,
  buildVoiceTestDispatchMetadata,
  validateCompiledPromptForPreview,
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

  test("shape is stable — exactly these 5 keys when no compiled prompt, nothing else", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(Object.keys(md).sort()).toEqual(
      ["agentName", "email", "mode", "session_id", "user_identifier"].sort(),
    );
  });

  // ---------------------------------------------------------------------------
  // ADR-015 preview mode — compiled_prompt injection
  //
  // The worker reads `compiled_prompt` from dispatch metadata and uses it as
  // the Agent's instructions instead of the baked-in profile prompt. Field
  // name is snake_case to match the other metadata fields and the Python
  // worker's `dispatch_metadata.get("compiled_prompt")` convention.
  // ---------------------------------------------------------------------------

  test("adds compiled_prompt field when compiledPrompt is provided", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "banknowa",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledPrompt: "You are a helpful assistant.",
    });
    expect(md.compiled_prompt).toBe("You are a helpful assistant.");
  });

  test("echoes compiled_prompt verbatim — no trimming or mutation", () => {
    // The prompt is content the worker uses literally as instructions. Any
    // normalization (whitespace, line endings) would silently alter behavior.
    const prompt = "  Line 1\n\r\nLine 2\t  \n";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledPrompt: prompt,
    });
    expect(md.compiled_prompt).toBe(prompt);
  });

  test("omits compiled_prompt when compiledPrompt is undefined", () => {
    // Default path is ADR-014: no override, worker profile is authoritative.
    // Presence of an empty-string key would still trip the override branch
    // in the worker, so the field must not exist at all.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect("compiled_prompt" in md).toBe(false);
  });

  test("omits compiled_prompt when compiledPrompt is an empty string", () => {
    // Empty string means "no compiled prompt exists" — don't pretend there
    // is one. The worker would override a real prompt with "" and go silent.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledPrompt: "",
    });
    expect("compiled_prompt" in md).toBe(false);
  });

  test("compiled_prompt survives JSON round-trip", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledPrompt: "System: act like a helpful assistant",
    });
    expect(JSON.parse(JSON.stringify(md))).toEqual(md);
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

// ---------------------------------------------------------------------------
// ADR-015 — size cap guard
//
// Dispatch metadata rides on the same job payload the LiveKit worker reads.
// We bound the prompt at 48 KB so a runaway compile (e.g. a SOP that
// accidentally inlines a knowledge-base dump) can't exhaust dispatch
// bandwidth or hit silent truncation at the worker. Validated as a pure
// helper so the policy is easy to revisit without spinning up a DB.
// ---------------------------------------------------------------------------

describe("validateCompiledPromptForPreview", () => {
  test("returns ok for a normal-sized prompt", () => {
    const result = validateCompiledPromptForPreview(
      "You are a helpful voice assistant.",
    );
    expect(result).toEqual({ ok: true });
  });

  test("rejects null with a 'no compiled prompt' error", () => {
    const result = validateCompiledPromptForPreview(null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/compile.+first/i);
  });

  test("rejects empty string as missing compiled prompt", () => {
    const result = validateCompiledPromptForPreview("");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/compile.+first/i);
  });

  test("rejects whitespace-only as missing", () => {
    const result = validateCompiledPromptForPreview("   \n\t  ");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/compile.+first/i);
  });

  test("accepts a prompt at the exact 48 KB byte boundary", () => {
    // Byte length, not char length — assert the cap is measured in bytes so
    // a prompt full of multi-byte characters can't sneak past.
    const boundary = "a".repeat(VOICE_TEST_PREVIEW_MAX_BYTES);
    expect(Buffer.byteLength(boundary, "utf8")).toBe(
      VOICE_TEST_PREVIEW_MAX_BYTES,
    );
    const result = validateCompiledPromptForPreview(boundary);
    expect(result).toEqual({ ok: true });
  });

  test("rejects a prompt one byte over the cap", () => {
    const overBy1 = "a".repeat(VOICE_TEST_PREVIEW_MAX_BYTES + 1);
    const result = validateCompiledPromptForPreview(overBy1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/48.*KB|too large/i);
  });

  test("counts bytes not characters — multi-byte unicode still capped", () => {
    // Each em dash is 3 bytes in UTF-8. Below char count but over byte cap.
    const emDash = "—"; // 3 bytes
    const many = emDash.repeat(Math.ceil(VOICE_TEST_PREVIEW_MAX_BYTES / 2));
    expect(many.length).toBeLessThan(VOICE_TEST_PREVIEW_MAX_BYTES);
    expect(Buffer.byteLength(many, "utf8")).toBeGreaterThan(
      VOICE_TEST_PREVIEW_MAX_BYTES,
    );
    const result = validateCompiledPromptForPreview(many);
    expect(result.ok).toBe(false);
  });
});
