/**
 * Outbound dispatch metadata — locks in the MG-agent-slug ↔ worker-profile
 * coupling for outbound calls, mirroring the voice-test contract.
 *
 * The LiveKit worker's entrypoint (see
 * `demos/bank-nowa/voice-agent/src/agent.py`) reads `agentName` from the
 * JSON metadata blob to pick a profile from its registry. Without this
 * field, a worker that hosts multiple profiles can't route and every
 * dispatched outbound call goes silent.
 */

import { describe, expect, test } from "bun:test";
import { buildOutboundDispatchMetadata } from "../../../src/features/agents/agents.service";

describe("buildOutboundDispatchMetadata", () => {
  test("carries agentName = agent.slug for multi-profile routing", () => {
    const md = buildOutboundDispatchMetadata({
      agentSlug: "banknowa_v2",
      sessionId: "sess-abc",
      phoneNumber: "+15551234567",
    });
    expect(md.agentName).toBe("banknowa_v2");
  });

  test("mode is a literal 'outbound' marker so the worker can branch on it", () => {
    const md = buildOutboundDispatchMetadata({
      agentSlug: "ttec",
      sessionId: "s",
      phoneNumber: "+1",
    });
    expect(md.mode).toBe("outbound");
  });

  test("phone_number + session_id + user_identifier carry call context", () => {
    const md = buildOutboundDispatchMetadata({
      agentSlug: "ttec",
      sessionId: "sess-xyz",
      phoneNumber: "+15557654321",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.phone_number).toBe("+15557654321");
    // user_identifier defaults to the phone number so downstream
    // session-attribution joins still have a stable handle.
    expect(md.user_identifier).toBe("+15557654321");
  });

  test("email + name are included only when provided", () => {
    const withExtras = buildOutboundDispatchMetadata({
      agentSlug: "ttec",
      sessionId: "s",
      phoneNumber: "+1",
      email: "c@x.com",
      name: "Candidate",
    });
    expect(withExtras.email).toBe("c@x.com");
    expect(withExtras.name).toBe("Candidate");

    const minimal = buildOutboundDispatchMetadata({
      agentSlug: "ttec",
      sessionId: "s",
      phoneNumber: "+1",
    });
    expect("email" in minimal).toBe(false);
    expect("name" in minimal).toBe(false);
  });

  test("agentSlug is echoed verbatim — no mutation", () => {
    // Guard against a refactor that lowercases/trims the slug; the worker
    // matches on exact string equality.
    const weird = "Weird_Slug-v1";
    const md = buildOutboundDispatchMetadata({
      agentSlug: weird,
      sessionId: "s",
      phoneNumber: "+1",
    });
    expect(md.agentName).toBe(weird);
  });

  test("round-trips through JSON without dropping fields", () => {
    const md = buildOutboundDispatchMetadata({
      agentSlug: "banknowa_v1",
      sessionId: "s",
      phoneNumber: "+48500000000",
      email: "c@x.com",
    });
    expect(JSON.parse(JSON.stringify(md))).toEqual(md);
  });
});
