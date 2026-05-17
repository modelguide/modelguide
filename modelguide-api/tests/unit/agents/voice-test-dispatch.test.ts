/**
 * Voice-test dispatch metadata — locks in the MG-agent-slug ↔ worker-profile
 * coupling AND the compiled-prompt sync contract. The LiveKit worker's
 * entrypoint reads `agentName` to pick a profile from its registry, and
 * (when present) `compiled_instructions` to override the baked-in prompt
 * with the latest ModelGuide-compiled SOP/persona output. See
 * `examples/agents/livekit-agent/src/agent.py`:
 *
 *     agent_name = dispatch_metadata.get("agentName")
 *     instructions_override = dispatch_metadata.get("compiled_instructions")
 *
 * If the field names or shape ever drift, every dispatched call goes
 * silent (wrong profile) or runs stale prompts (wrong override). There's
 * no type system connecting the two sides, so this test IS the contract.
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

  test("shape is stable — base shape is exactly these 5 keys when no compiled prompt is provided", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(Object.keys(md).sort()).toEqual(
      ["agentName", "email", "mode", "session_id", "user_identifier"].sort(),
    );
  });

  test("omits compiled_instructions when the agent has no compiled prompt", () => {
    // Worker falls back to its baked-in profile prompt when this key is
    // absent. We use *omission* rather than null so the Python side can
    // do a simple `if "compiled_instructions" in metadata:` check.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(md).not.toHaveProperty("compiled_instructions");
    expect(md).not.toHaveProperty("compiled_at");
  });

  test("carries compiled_instructions + compiled_at when provided", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: "You are a helpful voice agent.\nBe concise.",
      compiledAt: "2026-05-17T12:34:56.000Z",
    });
    expect(md.compiled_instructions).toBe(
      "You are a helpful voice agent.\nBe concise.",
    );
    expect(md.compiled_at).toBe("2026-05-17T12:34:56.000Z");
  });

  test("compiled_instructions is echoed verbatim — no mutation of the prompt", () => {
    // The prompt the user just compiled is what we want to test. Don't
    // trim, normalize whitespace, or fold blank lines — the worker should
    // see *exactly* what the dashboard showed.
    const prompt = "  # System\n\nYou are X.\n\n  Indented line.\n";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: prompt,
      compiledAt: "2026-05-17T12:34:56.000Z",
    });
    expect(md.compiled_instructions).toBe(prompt);
  });

  test("omits compiled_instructions when only compiledAt is provided (and vice-versa)", () => {
    // Both fields travel together or not at all — half-populated metadata
    // is a programming error, not a degraded mode.
    const onlyAt = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledAt: "2026-05-17T12:34:56.000Z",
    });
    expect(onlyAt).not.toHaveProperty("compiled_instructions");
    expect(onlyAt).not.toHaveProperty("compiled_at");

    const onlyPrompt = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledInstructions: "anything",
    });
    expect(onlyPrompt).not.toHaveProperty("compiled_instructions");
    expect(onlyPrompt).not.toHaveProperty("compiled_at");
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
