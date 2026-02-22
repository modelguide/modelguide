/**
 * Unit tests for the shared runHealthCheck utility.
 */

import { describe, expect, test } from "bun:test";
import { runHealthCheck } from "@features/connectors/catalog/lib/run-health-check";

describe("runHealthCheck", () => {
  test("returns healthy when probe succeeds", async () => {
    const result = await runHealthCheck(async () => {
      /* no-op — success */
    });

    expect(result.status).toBe("healthy");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
    expect(result.message).toBeUndefined();
  });

  test("returns error with message when probe throws Error", async () => {
    const result = await runHealthCheck(async () => {
      throw new Error("connection refused");
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("connection refused");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
  });

  test("returns error with stringified message for non-Error throws", async () => {
    const result = await runHealthCheck(async () => {
      throw "string error";
    });

    expect(result.status).toBe("error");
    expect(result.message).toBe("string error");
  });

  test("measures latency", async () => {
    const result = await runHealthCheck(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.status).toBe("healthy");
    expect(result.latencyMs).toBeGreaterThanOrEqual(40);
  });

  test("checkedAt is a valid ISO-8601 string", async () => {
    const result = await runHealthCheck(async () => {});

    const parsed = new Date(result.checkedAt);
    expect(parsed.toISOString()).toBe(result.checkedAt);
  });
});
