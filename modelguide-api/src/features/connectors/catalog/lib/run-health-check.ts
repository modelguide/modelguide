/**
 * Shared health check runner for connector modules.
 * Handles timing, error catching, and result formatting so each
 * connector only provides a probe function.
 */

import type { HealthCheckResult } from "../types";

export async function runHealthCheck(
  fn: () => Promise<void>,
): Promise<HealthCheckResult> {
  const start = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    await fn();
    return {
      status: "healthy",
      latencyMs: Math.round(performance.now() - start),
      checkedAt,
    };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Math.round(performance.now() - start),
      message: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}
