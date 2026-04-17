import { describe, expect, test } from "bun:test";
import {
  getElevenLabsExternalId,
  setElevenLabsExternalId,
} from "../../../src/features/agents/elevenlabs-metadata";

describe("getElevenLabsExternalId", () => {
  test("prefers externalId when both keys exist", () => {
    expect(
      getElevenLabsExternalId({
        externalId: "agent_external_123",
        agentId: "legacy_agent_123",
      }),
    ).toBe("agent_external_123");
  });

  test("falls back to legacy agentId", () => {
    expect(
      getElevenLabsExternalId({
        agentId: "legacy_agent_123",
      }),
    ).toBe("legacy_agent_123");
  });
});

describe("setElevenLabsExternalId", () => {
  test("writes externalId and the legacy agentId alias together", () => {
    expect(
      setElevenLabsExternalId(
        {
          llmModel: "claude-sonnet-4-5",
        },
        "agent_external_123",
      ),
    ).toEqual({
      llmModel: "claude-sonnet-4-5",
      externalId: "agent_external_123",
      agentId: "agent_external_123",
    });
  });
});
