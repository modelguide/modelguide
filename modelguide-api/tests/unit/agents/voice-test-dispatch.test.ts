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
  MAX_INSTRUCTIONS_BYTES,
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

  test("shape is stable — exactly these 5 keys when no prompt is injected", () => {
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
  // Prompt-injection contract (POC livekit-poc agent reads these fields from
  // dispatch metadata so the worker doesn't need an API round-trip to pick up
  // the latest compiled prompt). See ADR-015.
  // ---------------------------------------------------------------------------

  test("includes instructions when caller passes a compiled prompt", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "You are Sam. Be brief.",
    });
    expect(md.instructions).toBe("You are Sam. Be brief.");
  });

  test("includes greeting when caller passes one", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      greeting: "Hi, this is Sam — how can I help?",
    });
    expect(md.greeting).toBe("Hi, this is Sam — how can I help?");
  });

  test("omits instructions/greeting keys when not provided (no nulls)", () => {
    // Null/empty fields would force the POC worker to branch on truthiness.
    // Omitting them keeps the contract "key present ⇒ value is real".
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect("instructions" in md).toBe(false);
    expect("greeting" in md).toBe(false);
  });

  test("empty-string instructions are dropped (treated as 'not provided')", () => {
    // Guards against passing `agent.compiledInstructions ?? ""` from the
    // service layer. Empty prompt would put the LLM in undefined-behaviour
    // land; the worker should fall back to its baked-in default instead.
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "",
      greeting: "",
    });
    expect("instructions" in md).toBe(false);
    expect("greeting" in md).toBe(false);
  });

  test("instructions over MAX_INSTRUCTIONS_BYTES are dropped, not truncated", () => {
    // Truncating a system prompt mid-rule would have the LLM obey half a
    // contract — strictly worse than no contract at all. Drop entirely so
    // the worker falls back to its baked-in default.
    const oversize = "a".repeat(MAX_INSTRUCTIONS_BYTES + 1);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: oversize,
    });
    expect("instructions" in md).toBe(false);
  });

  test("instructions exactly at the cap are kept", () => {
    const exact = "a".repeat(MAX_INSTRUCTIONS_BYTES);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: exact,
    });
    expect(md.instructions).toBe(exact);
  });

  test("byte cap, not char cap (multi-byte chars count by UTF-8 size)", () => {
    // A char-based cap would let a 48K-emoji prompt past the byte cap and
    // explode the dispatch payload. Lock that in.
    const emoji = "🚀"; // 4 bytes in UTF-8
    // 12 * 1024 emoji = 48KB exactly. Add one more → over the cap.
    const justOver = emoji.repeat(12 * 1024 + 1);
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: justOver,
    });
    expect("instructions" in md).toBe(false);
  });

  test("instructions round-trip through JSON with multi-line content", () => {
    // Compiled prompts contain markdown headers + newlines. Confirm the
    // dispatch path doesn't smash them through JSON.stringify.
    const longPrompt = "# Role\nYou are Sam.\n\n## Tools\n- list_products\n";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: longPrompt,
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped.instructions).toBe(longPrompt);
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
