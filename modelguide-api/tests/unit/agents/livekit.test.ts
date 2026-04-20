/**
 * Unit tests for LiveKit helpers.
 *
 * generateBrowserAccessToken is a thin wrapper around livekit-server-sdk's
 * AccessToken used to mint short-lived JWTs that let a browser participant
 * join a specific room. It stays deterministic (no network) so it's tested
 * in isolation here; the end-to-end wiring is covered in the integration
 * tests for POST /api/agents/:id/browser-call.
 */

import { describe, expect, test } from "bun:test";

import { generateBrowserAccessToken } from "@features/agents/livekit";

function decodeJwtPayload<T>(jwt: string): T {
  const [, payload] = jwt.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
}

describe("generateBrowserAccessToken", () => {
  test("mints a JWT granting room-join access with audio publish", async () => {
    const jwt = await generateBrowserAccessToken({
      apiKey: "devkey",
      apiSecret: "secret-secret-secret-secret-32bytes",
      roomName: "test-room",
      identity: "alice",
      name: "Alice",
      ttlSeconds: 600,
    });

    expect(jwt).toBeString();
    expect(jwt.split(".")).toHaveLength(3);

    const payload = decodeJwtPayload<{
      sub: string;
      iss: string;
      name?: string;
      video: {
        room: string;
        roomJoin: boolean;
        canPublish: boolean;
        canSubscribe: boolean;
      };
      exp: number;
    }>(jwt);

    expect(payload.sub).toBe("alice");
    expect(payload.name).toBe("Alice");
    expect(payload.iss).toBe("devkey");
    expect(payload.video.room).toBe("test-room");
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);
    // TTL should be honoured (exp ~= now + 600s)
    const nowSec = Math.floor(Date.now() / 1000);
    expect(payload.exp - nowSec).toBeGreaterThanOrEqual(590);
    expect(payload.exp - nowSec).toBeLessThanOrEqual(610);
  });

  test("uses a sane default identity when none is provided", async () => {
    const jwt = await generateBrowserAccessToken({
      apiKey: "devkey",
      apiSecret: "secret-secret-secret-secret-32bytes",
      roomName: "test-room",
    });

    const payload = decodeJwtPayload<{ sub: string }>(jwt);
    expect(payload.sub).toBeString();
    expect(payload.sub.length).toBeGreaterThan(0);
  });
});
