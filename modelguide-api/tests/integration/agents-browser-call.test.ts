/**
 * Integration tests for POST /api/agents/:id/browser-call.
 *
 * The endpoint lets a browser user initiate a WebRTC session with a
 * LiveKit voice agent: it creates a ModelGuide session, dispatches the
 * agent to a new LiveKit room (passing the latest compiled instructions
 * as dispatch metadata so the agent runs the tested prompt), and returns
 * a short-lived LiveKit access token for the browser to connect with.
 *
 * The LiveKit server SDK is mocked because CI has no LiveKit instance —
 * we assert that dispatch is called with the right arguments.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { forApp } from "@db/rls";
import { agents, secrets } from "@db/schema";
import { encryptSecret } from "@lib/crypto";
import { inArray } from "drizzle-orm";

import { authHeadersFor, getTestSeed } from "../helpers/seed";

// ============================================================================
// Mock LiveKit dispatch — token generation stays real (no network).
// ============================================================================

const dispatchMock = mock(async () => "DISPATCH_ID_123");

mock.module("@features/agents/livekit", async () => {
  const actual = await import(
    /* @vite-ignore */ "../../src/features/agents/livekit"
  );
  return {
    ...actual,
    dispatchAgentToRoom: dispatchMock,
    pingLivekit: mock(async () => undefined),
  };
});

// Dynamic import after mock so the mock is in effect
const app = (await import("@/app")).default;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

// ============================================================================
// Test setup
// ============================================================================

const createdAgentIds: string[] = [];
const createdSecretIds: string[] = [];

async function createLivekitTestAgent(opts: {
  orgId: string;
  compiledInstructions?: string | null;
  isActive?: boolean;
  modality?: "voice" | "text";
  agentPlatform?: "livekit" | "custom" | "elevenlabs";
  withConfig?: boolean;
}): Promise<string> {
  const {
    orgId,
    compiledInstructions = "You are a helpful test agent.",
    isActive = true,
    modality = "voice",
    agentPlatform = "livekit",
    withConfig = true,
  } = opts;

  return forApp(async (tx) => {
    let livekitKeyId: string | undefined;
    let livekitSecretId: string | undefined;
    if (withConfig) {
      const [k] = await tx
        .insert(secrets)
        .values({
          organizationId: orgId,
          name: "test-livekit-api-key",
          secretType: "api_key",
          encryptedValue: await encryptSecret("APItestkey123"),
          scope: "agent",
        })
        .returning({ id: secrets.id });
      const [s] = await tx
        .insert(secrets)
        .values({
          organizationId: orgId,
          name: "test-livekit-api-secret",
          secretType: "credentials",
          encryptedValue: await encryptSecret(
            "secret-secret-secret-secret-32bytes",
          ),
          scope: "agent",
        })
        .returning({ id: secrets.id });
      livekitKeyId = k.id;
      livekitSecretId = s.id;
      createdSecretIds.push(k.id, s.id);
    }

    const metadata: Record<string, unknown> = {};
    if (withConfig) {
      metadata.livekit = {
        url: "wss://test.livekit.cloud",
        agentName: "buildpro-sam",
      };
    }

    const [agent] = await tx
      .insert(agents)
      .values({
        organizationId: orgId,
        name: `browser-call-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        slug: `browser-call-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        modality,
        modelFamily: "generic",
        promptConfig: {},
        agentPlatform,
        metadata,
        secrets: {
          ...(livekitKeyId && { livekit_api_key: livekitKeyId }),
          ...(livekitSecretId && { livekit_api_secret: livekitSecretId }),
        },
        isActive,
        compiledInstructions: compiledInstructions ?? null,
      })
      .returning({ id: agents.id });

    createdAgentIds.push(agent.id);
    return agent.id;
  });
}

let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let orgAId: string;

beforeAll(async () => {
  const seed = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(seed.orgAAdmin);
  orgASupportHeaders = await authHeadersFor(seed.orgASupport);
  orgBAdminHeaders = await authHeadersFor(seed.orgBAdmin);
  orgAId = seed.orgA.id;
});

afterAll(async () => {
  await forApp(async (tx) => {
    if (createdAgentIds.length) {
      await tx.delete(agents).where(inArray(agents.id, createdAgentIds));
    }
    if (createdSecretIds.length) {
      await tx.delete(secrets).where(inArray(secrets.id, createdSecretIds));
    }
  });
});

// ============================================================================
// Tests
// ============================================================================

describe("POST /api/agents/:id/browser-call", () => {
  test("returns 201 with token + url + roomName + sessionId", async () => {
    dispatchMock.mockClear();
    const agentId = await createLivekitTestAgent({ orgId: orgAId });

    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      token: string;
      url: string;
      roomName: string;
      sessionId: string;
      dispatchId: string;
    };

    expect(body.token).toBeString();
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.url).toBe("wss://test.livekit.cloud");
    expect(body.roomName).toStartWith("browser-");
    expect(body.sessionId).toBeString();
    expect(body.dispatchId).toBe("DISPATCH_ID_123");
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  test("dispatch metadata includes the latest compiledInstructions", async () => {
    dispatchMock.mockClear();
    const agentId = await createLivekitTestAgent({
      orgId: orgAId,
      compiledInstructions: "SYSTEM PROMPT v42 — always say hi.",
    });

    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ identity: "tester@example.com" }),
    });

    expect(res.status).toBe(201);
    const call = dispatchMock.mock.calls[0] as unknown as unknown[];
    const metadata = call[5] as Record<string, unknown>;
    expect(metadata.instructions).toBe("SYSTEM PROMPT v42 — always say hi.");
    expect(metadata.session_id).toBeString();
    expect(metadata.user_identifier).toBe("tester@example.com");
  });

  test("rejects non-voice agents (400)", async () => {
    const agentId = await createLivekitTestAgent({
      orgId: orgAId,
      modality: "text",
    });
    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects non-livekit agents (400)", async () => {
    const agentId = await createLivekitTestAgent({
      orgId: orgAId,
      agentPlatform: "custom",
    });
    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects inactive agents (400)", async () => {
    const agentId = await createLivekitTestAgent({
      orgId: orgAId,
      isActive: false,
    });
    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects when LiveKit is not configured (400)", async () => {
    const agentId = await createLivekitTestAgent({
      orgId: orgAId,
      withConfig: false,
    });
    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects support role (403)", async () => {
    const agentId = await createLivekitTestAgent({ orgId: orgAId });
    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  test("isolates across orgs (404)", async () => {
    const agentId = await createLivekitTestAgent({ orgId: orgAId });
    const res = await request(`/api/agents/${agentId}/browser-call`, {
      method: "POST",
      headers: orgBAdminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
