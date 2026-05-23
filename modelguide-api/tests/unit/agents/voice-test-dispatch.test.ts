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
  const baseInput = {
    agentSlug: "banknowa_v1",
    agentId: "11111111-1111-1111-1111-111111111111",
    sessionId: "sess-abc",
    callerEmail: "admin@example.com",
  };

  test("carries agentName = agent.slug for multi-profile routing", () => {
    const md = buildVoiceTestDispatchMetadata(baseInput);
    // The single most important field — workers route on this.
    expect(md.agentName).toBe("banknowa_v1");
  });

  test("mode is a literal 'voice-test' marker", () => {
    const md = buildVoiceTestDispatchMetadata(baseInput);
    expect(md.mode).toBe("voice-test");
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildVoiceTestDispatchMetadata({
      ...baseInput,
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("mg_agent_id is the MG agent UUID — the worker uses it to pull the latest compiled prompt", () => {
    // This is the runtime-prompt-fetch contract (ADR-015). The worker reads
    // `mg_agent_id` from dispatch metadata and calls
    // `GET /api/agents/:id` to retrieve the current `compiledInstructions`.
    // If the field name drifts, the worker silently falls back to its
    // baked-in prompt and "Sync & Test" stops actually testing the latest
    // compiled prompt.
    const md = buildVoiceTestDispatchMetadata({
      ...baseInput,
      agentId: "22222222-2222-2222-2222-222222222222",
    });
    expect(md.mg_agent_id).toBe("22222222-2222-2222-2222-222222222222");
  });

  test("shape is stable — exactly these 6 keys, nothing else", () => {
    const md = buildVoiceTestDispatchMetadata(baseInput);
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "email",
        "mg_agent_id",
        "mode",
        "session_id",
        "user_identifier",
      ].sort(),
    );
  });

  test("agentSlug is echoed verbatim — no mutation", () => {
    // Guard against a well-meaning refactor that lowercases/trims the slug
    // "to match a worker convention". The worker matches on exact string
    // equality, so any transform silently breaks routing.
    const weird = "Weird_Slug-v1";
    const md = buildVoiceTestDispatchMetadata({
      ...baseInput,
      agentSlug: weird,
    });
    expect(md.agentName).toBe(weird);
  });

  test("round-trips through JSON without dropping fields", () => {
    // The dispatch layer JSON-stringifies this payload. Confirm nothing is
    // a Symbol, function, or other unserializable value.
    const md = buildVoiceTestDispatchMetadata({
      ...baseInput,
      agentSlug: "banknowa_v2",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });
});
