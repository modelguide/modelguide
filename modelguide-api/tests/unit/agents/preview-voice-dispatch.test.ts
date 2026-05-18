/**
 * Preview-voice dispatch metadata — locks in the contract the preview
 * LiveKit worker (examples/agents/livekit-preview-agent) reads to wire
 * up an ad-hoc voice session against an *un-deployed* compiled prompt.
 *
 * Unlike voice-test (ADR-014), the preview flow intentionally injects
 * the compiled prompt via `instructions_override` so the operator can
 * hear how an edit sounds before promoting it onto the production
 * worker. The worker's entrypoint reads:
 *
 *     mode = dispatch_metadata.get("mode")
 *     if mode == "preview":
 *         instructions = dispatch_metadata.get("instructions_override")
 *
 * If the field name or shape ever drifts, dispatched preview rooms go
 * silent (worker can't find the prompt and bails). There's no type
 * system connecting the TS API to the Python worker, so this test IS
 * the contract.
 */

import { describe, expect, test } from "bun:test";
import { buildPreviewDispatchMetadata } from "../../../src/features/agents/agents.service";

describe("buildPreviewDispatchMetadata", () => {
  test("carries agentName = agent.slug so a multi-profile preview worker routes", () => {
    const md = buildPreviewDispatchMetadata({
      agentSlug: "buildpro_sam",
      sessionId: "sess-abc",
      callerEmail: "admin@example.com",
      instructions: "You are a helpful voice agent.",
    });
    expect(md.agentName).toBe("buildpro_sam");
  });

  test("mode is the literal 'preview' marker", () => {
    const md = buildPreviewDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "x",
    });
    expect(md.mode).toBe("preview");
  });

  test("instructions_override echoes the prompt verbatim — no mutation", () => {
    // The whole point of preview is "test exactly this prompt." If a
    // well-meaning refactor normalises whitespace or trims trailing
    // newlines, the preview no longer reflects the compiled output.
    const prompt = "# Role\nYou are Sam.\n\n# Rules\n- Be concise.\n";
    const md = buildPreviewDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: prompt,
    });
    expect(md.instructions_override).toBe(prompt);
  });

  test("session_id + user_identifier + email carry caller context", () => {
    const md = buildPreviewDispatchMetadata({
      agentSlug: "tenant_a",
      sessionId: "sess-xyz",
      callerEmail: "tester@corp.com",
      instructions: "y",
    });
    expect(md.session_id).toBe("sess-xyz");
    expect(md.user_identifier).toBe("tester@corp.com");
    expect(md.email).toBe("tester@corp.com");
  });

  test("shape is stable — exactly these 6 keys, nothing else", () => {
    const md = buildPreviewDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "y",
    });
    expect(Object.keys(md).sort()).toEqual(
      [
        "agentName",
        "email",
        "instructions_override",
        "mode",
        "session_id",
        "user_identifier",
      ].sort(),
    );
  });

  test("round-trips through JSON without dropping fields", () => {
    // The dispatch layer JSON-stringifies this payload. Confirm nothing
    // is a Symbol, function, or other unserializable value.
    const md = buildPreviewDispatchMetadata({
      agentSlug: "preview_v1",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: "system prompt",
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped).toEqual(md);
  });

  test("supports unicode + multi-line prompts (UTF-8 byte boundaries safe)", () => {
    const prompt = "Du sprichst Deutsch. 🇩🇪\nAntworte kurz.\nBis bald.";
    const md = buildPreviewDispatchMetadata({
      agentSlug: "x",
      sessionId: "s",
      callerEmail: "c@e.com",
      instructions: prompt,
    });
    const roundTripped = JSON.parse(JSON.stringify(md));
    expect(roundTripped.instructions_override).toBe(prompt);
  });
});
