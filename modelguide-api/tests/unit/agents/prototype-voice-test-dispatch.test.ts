/**
 * Prototype voice-test dispatch metadata — locks in the contract between the
 * MG API and the prototype LiveKit worker (`examples/agents/livekit-prototype`).
 *
 * Unlike the production voice-test flow (see ADR-014), the prototype flow
 * intentionally injects the agent's compiled prompt into dispatch metadata so
 * an admin can edit a prompt in the UI, click "Sync & Test", and immediately
 * talk to a worker that reflects the latest text — without redeploying.
 *
 * The Python worker reads:
 *   - dispatch_metadata["agentName"]    → optional profile slug echo
 *   - dispatch_metadata["instructions"] → REQUIRED: the system prompt to use
 *   - dispatch_metadata["session_id"]   → MG session for transcript posting
 *
 * Field names + shape are NOT type-checked across the language boundary, so
 * this test file IS the contract. ADR-015 documents the trade-off.
 */

import { describe, expect, test } from "bun:test";
import { buildPrototypeDispatchMetadata } from "../../../src/features/agents/agents.service";

describe("buildPrototypeDispatchMetadata", () => {
  test("carries agentName = agent.slug for routing parity with prod voice-test", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "demo_v1",
      sessionId: "sess-1",
      callerEmail: "admin@example.com",
      instructions: "You are a helpful agent.",
    });
    expect(md.agentName).toBe("demo_v1");
  });

  test("mode is the literal 'voice-test-prototype' marker", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "x",
    });
    expect(md.mode).toBe("voice-test-prototype");
  });

  test("instructions are echoed verbatim — the worker uses this as the system prompt", () => {
    const prompt =
      "# Role\nYou are an HVAC dispatcher.\n\n# Tone\nBrief and warm.";
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "hvac",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: prompt,
    });
    expect(md.instructions).toBe(prompt);
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "x",
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
      instructions: "x",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("shape is stable — exactly these 6 keys, nothing else", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "x",
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

  test("round-trips through JSON without dropping fields (dispatcher JSON-stringifies)", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "demo",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "Multi-line\nprompt with \"quotes\" and 'apostrophes'.",
    });
    expect(JSON.parse(JSON.stringify(md))).toEqual(md);
  });

  test("rejects empty instructions — worker has no fallback prompt", () => {
    expect(() =>
      buildPrototypeDispatchMetadata({
        agentSlug: "x",
        sessionId: "s",
        callerEmail: "c@e.com",
        instructions: "",
      }),
    ).toThrow(/instructions/i);
  });

  test("rejects whitespace-only instructions — same reason", () => {
    expect(() =>
      buildPrototypeDispatchMetadata({
        agentSlug: "x",
        sessionId: "s",
        callerEmail: "c@e.com",
        instructions: "   \n\t  ",
      }),
    ).toThrow(/instructions/i);
  });
});
