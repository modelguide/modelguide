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

  test("shape is stable — exactly these 5 keys, nothing else", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect(Object.keys(md).sort()).toEqual(
      ["agentName", "email", "mode", "session_id", "user_identifier"].sort(),
    );
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

  // --------------------------------------------------------------------
  // Prompt-sync prototype (ADR-015): when the dashboard wants the worker
  // to use the *latest compiled prompt* instead of its baked-in profile
  // prompt, the prompt rides in the dispatch metadata under
  // `compiled_prompt` (snake_case to match the rest of the worker-facing
  // payload). `compiled_prompt_compiled_at` carries the timestamp so the
  // worker can log which version it ran with.
  // --------------------------------------------------------------------

  test("omits compiled_prompt when caller does not opt in", () => {
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
    });
    expect("compiled_prompt" in md).toBe(false);
    expect("compiled_prompt_compiled_at" in md).toBe(false);
  });

  test("carries compiled_prompt verbatim when supplied", () => {
    const promptBody = "You are Sam. Answer in one sentence.";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "banknowa_v1",
      sessionId: "sess-1",
      callerEmail: "tester@corp.com",
      compiledPrompt: promptBody,
      compiledAt: "2026-06-07T00:00:00.000Z",
    });
    expect(md.compiled_prompt).toBe(promptBody);
    expect(md.compiled_prompt_compiled_at).toBe("2026-06-07T00:00:00.000Z");
    // Routing field MUST still be the slug — the prompt-sync prototype
    // adds a payload but does not change which worker profile is picked.
    expect(md.agentName).toBe("banknowa_v1");
  });

  test("compiled_prompt round-trips through JSON unchanged", () => {
    // Worker uses json.loads() — verify Unicode / newline / quote chars
    // survive untouched.
    const tricky = "Línea 1\nLínea 2 — “quoted” \\backslash";
    const md = buildVoiceTestDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      compiledPrompt: tricky,
      compiledAt: "2026-06-07T00:00:00.000Z",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped.compiled_prompt).toBe(tricky);
  });
});
