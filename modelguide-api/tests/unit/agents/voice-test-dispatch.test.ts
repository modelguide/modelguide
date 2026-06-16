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
      agentId: "11111111-1111-1111-1111-111111111111",
      agentSlug: "banknowa_v1",
      sessionId: "sess-abc",
      callerEmail: "admin@example.com",
    });
    // The single most important field — workers route on this.
    expect(md.agentName).toBe("banknowa_v1");
  });

  test("mode is a literal 'voice-test' marker", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentId: "11111111-1111-1111-1111-111111111111",
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(md.mode).toBe("voice-test");
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentId: "11111111-1111-1111-1111-111111111111",
      agentSlug: "tenant_a",
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("shape is stable — exactly these 6 keys, nothing else", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentId: "11111111-1111-1111-1111-111111111111",
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "agent_id",
        "email",
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
      agentId: "11111111-1111-1111-1111-111111111111",
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
      agentId: "11111111-1111-1111-1111-111111111111",
      agentSlug: "banknowa_v2",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });

  // ------------------------------------------------------------------
  // agent_id (new — added for the livekit-poc worker)
  //
  // The livekit-poc worker (examples/agents/livekit-poc/) reads
  // ``agent_id`` from this metadata so it can pull the latest compiled
  // prompt from ``GET /api/agents/:id`` at session start, giving operators
  // a one-click "compile → test the live prompt" loop without baking the
  // prompt into the worker image.
  //
  // Keeping the field key in snake_case matches the rest of the payload
  // (Python-side conventions). agentName stays camelCase because changing
  // it would silently break every deployed worker that reads it.
  // ------------------------------------------------------------------

  test("agent_id is echoed verbatim — POC worker uses it to fetch the live prompt", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      agentSlug: "any",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(md.agent_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("agent_id and agentName are independent — slug renames don't change the ID lookup", () => {
    // The slug is human-readable and can be renamed in the dashboard. The
    // POC worker keys on agent_id (UUID, immutable) so a rename mid-test
    // doesn't break the prompt fetch.
    const md = buildVoiceTestDispatchMetadata({
      agentId: "11111111-1111-1111-1111-111111111111",
      agentSlug: "renamed-slug",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(md.agent_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(md.agentName).toBe("renamed-slug");
  });
});
