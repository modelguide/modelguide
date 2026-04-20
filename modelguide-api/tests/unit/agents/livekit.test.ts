/**
 * Unit tests for LiveKit helpers — covers voice-test token generation.
 *
 * These tests exercise the pure functions in livekit.ts that do not require
 * a live LiveKit connection: generating an AccessToken JWT whose claims
 * grant the caller permission to join a specific room.
 */

import { describe, expect, test } from "bun:test";
import { generateVoiceTestToken } from "../../../src/features/agents/livekit";

/** Decode a JWT payload without verifying the signature. */
function decodeJwt(token: string): Record<string, unknown> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error(`expected 3 JWT segments, got ${segments.length}`);
  }
  const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

const TEST_API_KEY = "APIxxxxxxxxxxxx";
const TEST_API_SECRET =
  "secretsecretsecretsecretsecretsecretsecretsecretsecretsecret";

describe("generateVoiceTestToken", () => {
  test("returns a signed JWT containing the room and identity claims", async () => {
    const token = await generateVoiceTestToken({
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      roomName: "voice-test-room",
      identity: "user-abc",
      name: "Jane Doe",
      ttlSeconds: 600,
    });

    expect(typeof token).toBe("string");
    // JWTs always have three dot-separated segments.
    expect(token.split(".").length).toBe(3);

    const claims = decodeJwt(token);

    // LiveKit encodes identity as `sub` and the video grant under `video`.
    expect(claims.sub).toBe("user-abc");
    expect(claims.name).toBe("Jane Doe");
    expect(claims.iss).toBe(TEST_API_KEY);

    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe("voice-test-room");
    expect(video.roomJoin).toBe(true);
    expect(video.canPublish).toBe(true);
    expect(video.canSubscribe).toBe(true);
  });

  test("honours ttlSeconds (exp ~= now + ttl)", async () => {
    const nowBefore = Math.floor(Date.now() / 1000);
    const token = await generateVoiceTestToken({
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      roomName: "r",
      identity: "u",
      ttlSeconds: 3600,
    });
    const claims = decodeJwt(token) as unknown as { exp?: number };
    expect(claims.exp).toBeDefined();
    const diff = (claims.exp ?? 0) - nowBefore;
    // Allow a few seconds of drift for test overhead.
    expect(diff).toBeGreaterThan(3595);
    expect(diff).toBeLessThan(3610);
  });

  test("uses a sensible default TTL when ttlSeconds omitted", async () => {
    const nowBefore = Math.floor(Date.now() / 1000);
    const token = await generateVoiceTestToken({
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      roomName: "r",
      identity: "u",
    });
    const claims = decodeJwt(token) as unknown as { exp?: number };
    const diff = (claims.exp ?? 0) - nowBefore;
    // Default is ≥ 5 min, ≤ 30 min — keeps voice-test sessions short-lived.
    expect(diff).toBeGreaterThanOrEqual(5 * 60);
    expect(diff).toBeLessThanOrEqual(30 * 60);
  });
});
