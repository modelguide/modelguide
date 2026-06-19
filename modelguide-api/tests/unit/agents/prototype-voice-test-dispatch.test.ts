/**
 * Prototype voice-test dispatch metadata — locks in the shape that the
 * prototype LiveKit worker reads.
 *
 * Unlike the production voice-test contract (see voice-test-dispatch.test.ts
 * and ADR-014), this dispatch carries the compiled agent prompt inline so an
 * admin can iterate on prompt copy without redeploying a worker profile.
 * The prototype worker (examples/agents/livekit-prototype/src/agent.py)
 * reads `instructions` from the JSON blob and instantiates a vanilla
 * session with that as the system prompt.
 *
 * ADR-015 documents the trade-off — this mode is for fast iteration only
 * and is gated on `agentPlatform === "livekit"` + `mode === "prototype"`.
 */

import { describe, expect, test } from "bun:test";
import {
  MAX_PROTOTYPE_INSTRUCTIONS_LENGTH,
  buildPrototypeDispatchMetadata,
} from "../../../src/features/agents/agents.service";

describe("buildPrototypeDispatchMetadata", () => {
  test("mode is a literal 'prototype' marker", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "You are helpful.",
    });
    expect(md.mode).toBe("prototype");
  });

  test("carries agentName = agent.slug so multi-profile workers can route", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "demo_v1",
      sessionId: "sess-abc",
      callerEmail: "admin@example.com",
      instructions: "Be brief.",
    });
    expect(md.agentName).toBe("demo_v1");
  });

  test("instructions are echoed verbatim — no trimming, no transform", () => {
    // The prototype worker uses these as the system prompt as-is. Any silent
    // transform (.trim(), normalizeWhitespace, etc.) would create a "tested
    // in dashboard, broken in deploy" gap.
    const weird = "  Line 1\n\n  Line 2  ";
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: weird,
    });
    expect(md.instructions).toBe(weird);
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "tenant_a",
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
      instructions: "p",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("shape is stable — exactly these 6 keys, nothing else", () => {
    // Guard against an additive change shipping un-noticed. A new field added
    // here without a matching read on the worker side would silently dilute
    // the metadata budget (LiveKit caps dispatch metadata at ~48 KB).
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "p",
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

  test("round-trips through JSON without dropping fields", () => {
    const md = buildPrototypeDispatchMetadata({
      agentSlug: "demo_v2",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "You are a voice assistant.",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });

  test("MAX_PROTOTYPE_INSTRUCTIONS_LENGTH is exported and reasonable (~50K)", () => {
    // The cap is enforced by the service before this helper is called, but
    // the constant lives next to the helper because they're the contract.
    // 50K is roughly the largest prompt we've seen in compiled SOPs and
    // leaves headroom inside LiveKit's ~48 KB serialized metadata budget
    // once JSON-encoded — most real prompts are <10 KB.
    expect(MAX_PROTOTYPE_INSTRUCTIONS_LENGTH).toBeGreaterThanOrEqual(10_000);
    expect(MAX_PROTOTYPE_INSTRUCTIONS_LENGTH).toBeLessThanOrEqual(60_000);
  });
});
