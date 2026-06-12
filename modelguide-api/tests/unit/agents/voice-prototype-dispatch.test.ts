/**
 * Voice-prototype dispatch metadata — locks in the contract between the
 * ModelGuide API and the prompt-driven LiveKit entrypoint
 * (`examples/agents/livekit-agent/src/prompt_entry.py`).
 *
 * The worker's ``parse_dispatch_metadata`` rejects anything that doesn't
 * carry ``mode = voice-prototype`` and the four payload fields below —
 * which is exactly the safety the production "Talk to agent" flow loses
 * by injecting a prompt (see ADR-014 vs ADR-015). So this test is the
 * counterpart to ``tests/test_prompt_agent.py::TestParseDispatchMetadata``
 * on the API side: if either side drifts, voice-prototype goes silent
 * and CI catches it before a release.
 */

import { describe, expect, test } from "bun:test";
import { buildVoicePrototypeDispatchMetadata } from "../../../src/features/agents/agents.service";

describe("buildVoicePrototypeDispatchMetadata", () => {
  test("mode is the literal 'voice-prototype' marker", () => {
    const md = buildVoicePrototypeDispatchMetadata({
      agentId: "agt_1",
      agentSlug: "demo-bot",
      sessionId: "sess_1",
      callerEmail: "tester@example.com",
      compiledPrompt: "You are helpful.",
    });
    expect(md.mode).toBe("voice-prototype");
  });

  test("compiled prompt is echoed verbatim — no trimming or transform", () => {
    // Whitespace + newlines matter for prompt rendering; a "helpful" trim
    // here would silently change behavior the operator just compiled.
    const prompt = "  You are Sam.\n\nAlways answer in one sentence.\n  ";
    const md = buildVoicePrototypeDispatchMetadata({
      agentId: "agt_1",
      agentSlug: "demo-bot",
      sessionId: "sess_1",
      callerEmail: "tester@example.com",
      compiledPrompt: prompt,
    });
    expect(md.compiled_prompt).toBe(prompt);
  });

  test("agent_id + session_id + email carry correlation context", () => {
    const md = buildVoicePrototypeDispatchMetadata({
      agentId: "agt_xyz",
      agentSlug: "demo-bot",
      sessionId: "sess_xyz",
      callerEmail: "admin@corp.com",
      compiledPrompt: "Hi.",
    });
    expect(md.agent_id).toBe("agt_xyz");
    expect(md.session_id).toBe("sess_xyz");
    expect(md.user_identifier).toBe("admin@corp.com");
    expect(md.email).toBe("admin@corp.com");
  });

  test("agentName mirrors agent.slug so a multi-profile worker still routes", () => {
    // We don't run a *separate* worker for the prototype — operators reuse
    // the existing LiveKit worker process. Mirroring the slug here keeps
    // the dispatch path identical so multi-profile routing stays intact.
    const md = buildVoicePrototypeDispatchMetadata({
      agentId: "agt_1",
      agentSlug: "Weird_Slug-v1",
      sessionId: "sess_1",
      callerEmail: "tester@example.com",
      compiledPrompt: "Hi.",
    });
    expect(md.agentName).toBe("Weird_Slug-v1");
  });

  test("shape is stable — exactly these 7 keys, nothing else", () => {
    const md = buildVoicePrototypeDispatchMetadata({
      agentId: "agt_1",
      agentSlug: "demo-bot",
      sessionId: "sess_1",
      callerEmail: "tester@example.com",
      compiledPrompt: "Hi.",
    });
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "agent_id",
        "compiled_prompt",
        "email",
        "mode",
        "session_id",
        "user_identifier",
      ].sort(),
    );
  });

  test("round-trips through JSON without dropping fields", () => {
    const md = buildVoicePrototypeDispatchMetadata({
      agentId: "agt_1",
      agentSlug: "demo-bot",
      sessionId: "sess_1",
      callerEmail: "tester@example.com",
      compiledPrompt: "Hi.",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });

  test("throws if compiled prompt is empty — the whole point is the prompt", () => {
    expect(() =>
      buildVoicePrototypeDispatchMetadata({
        agentId: "agt_1",
        agentSlug: "demo-bot",
        sessionId: "sess_1",
        callerEmail: "tester@example.com",
        compiledPrompt: "",
      }),
    ).toThrow(/compiled prompt/i);
  });

  test("throws if compiled prompt is whitespace-only", () => {
    // Guard the second failure mode the Python parser also guards: a
    // "present but blank" prompt that would silently degrade to a no-op LLM.
    expect(() =>
      buildVoicePrototypeDispatchMetadata({
        agentId: "agt_1",
        agentSlug: "demo-bot",
        sessionId: "sess_1",
        callerEmail: "tester@example.com",
        compiledPrompt: "   \n\t  ",
      }),
    ).toThrow(/compiled prompt/i);
  });
});
