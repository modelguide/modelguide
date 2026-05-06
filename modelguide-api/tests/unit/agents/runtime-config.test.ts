/**
 * Pure-function unit tests for `formatRuntimeConfig`.
 *
 * The runtime-config endpoint returns a deliberately narrow payload — see
 * `agent-runtime-config.test.ts` (integration) for the route-level contract.
 * This test pins the exact shape so a refactor of the dashboard agent
 * response (which happily carries secrets, integrationUrls, etc.) doesn't
 * accidentally widen the worker-facing payload.
 */

import { describe, expect, test } from "bun:test";
import type { Agent } from "@db/schema";
import { formatRuntimeConfig } from "../../../src/features/agents/agents.service";

function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  const now = new Date("2026-04-01T00:00:00Z");
  return {
    id: "00000000-0000-0000-0000-000000000abc",
    organizationId: "00000000-0000-0000-0000-0000000000aa",
    name: "Demo Voice Agent",
    slug: "demo-voice",
    description: null,
    modality: "voice",
    modelFamily: "gpt",
    promptConfig: {},
    agentPlatform: "livekit",
    isActive: true,
    metadata: { livekit: { url: "wss://x", agentName: "demo-voice" } },
    secrets: { livekit_api_key: "00000000-0000-0000-0000-000000000111" },
    compiledInstructions: "You are Demo. Say hi.",
    compiledAt: now,
    compiledFrom: null,
    keyPrefix: "mgk_demo",
    elevenlabsKeyEncrypted: null,
    webhookSecretEncrypted: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as Agent;
}

describe("formatRuntimeConfig", () => {
  test("returns the worker-facing fields verbatim", () => {
    const out = formatRuntimeConfig(fakeAgent());
    expect(out).toEqual({
      id: "00000000-0000-0000-0000-000000000abc",
      name: "Demo Voice Agent",
      slug: "demo-voice",
      modality: "voice",
      agentPlatform: "livekit",
      modelFamily: "gpt",
      isActive: true,
      compiledInstructions: "You are Demo. Say hi.",
      compiledAt: "2026-04-01T00:00:00.000Z",
      promptConfig: {},
      metadata: { livekit: { url: "wss://x", agentName: "demo-voice" } },
    });
  });

  test("does NOT leak secrets, keyPrefix, or webhook flags", () => {
    // Guard against a refactor that swaps formatRuntimeConfig for the
    // dashboard's formatAgent. The worker's API key already grants
    // narrower scope than a user JWT — keep the response narrow too.
    const out = formatRuntimeConfig(fakeAgent());
    expect(out).not.toHaveProperty("secrets");
    expect(out).not.toHaveProperty("integrationUrls");
    expect(out).not.toHaveProperty("evalSuiteCount");
    expect(out).not.toHaveProperty("keyPrefix");
    expect(out).not.toHaveProperty("hasElevenLabsKey");
    expect(out).not.toHaveProperty("hasWebhookSecret");
    expect(out).not.toHaveProperty("organizationId");
    expect(out).not.toHaveProperty("description");
  });

  test("returns null compiledInstructions/compiledAt when not yet compiled", () => {
    const out = formatRuntimeConfig(
      fakeAgent({ compiledInstructions: null, compiledAt: null }),
    );
    expect(out.compiledInstructions).toBeNull();
    expect(out.compiledAt).toBeNull();
  });

  test("metadata defaults to {} when null", () => {
    const out = formatRuntimeConfig(
      fakeAgent({ metadata: null as unknown as Record<string, unknown> }),
    );
    expect(out.metadata).toEqual({});
  });
});
