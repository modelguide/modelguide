/**
 * Retry policy for the LoreVault signal emission queue.
 *
 * Spec §7.2: "exponential backoff, max 6 attempts over ~10 minutes".
 * The default schedule below sums to ~620 seconds across 5 retries:
 *   1s → 5s → 30s → 60s → 240s → 300s (capped)
 */

import type { RetryPolicy } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 6;

const DEFAULT_DELAY_SCHEDULE_MS: number[] = [
  1_000, 5_000, 30_000, 60_000, 240_000, 300_000,
];

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  delayMs(attempt: number): number {
    if (attempt < 0) return 0;
    const index = Math.min(attempt, DEFAULT_DELAY_SCHEDULE_MS.length - 1);
    return DEFAULT_DELAY_SCHEDULE_MS[index];
  },
};

/**
 * Test-friendly factory that returns a fixed delay per retry. The total
 * elapsed time scales with `attemptDelayMs * (maxAttempts - 1)`.
 */
export function fixedRetryPolicy(
  attemptDelayMs: number,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): RetryPolicy {
  return {
    maxAttempts,
    delayMs: () => attemptDelayMs,
  };
}
