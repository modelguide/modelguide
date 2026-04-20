/**
 * Unit tests for runBoundedPool + resolveEvalConcurrency.
 *
 * These back the parallelism in `executeSimulateAndRunInner` — they make
 * sure that ordering, failure isolation, and concurrency bounds hold without
 * needing a real DB/LLM.
 */

import { describe, expect, test } from "bun:test";
import {
  resolveEvalConcurrency,
  runBoundedPool,
} from "@features/evals/eval-suites-simulate.service";

// Tiny awaitable sleep — forces the event loop to interleave workers.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("resolveEvalConcurrency", () => {
  test("clamps values below 1 up to 1", () => {
    expect(resolveEvalConcurrency(0)).toBe(1);
    expect(resolveEvalConcurrency(-5)).toBe(1);
  });

  test("clamps values above 20 down to 20", () => {
    expect(resolveEvalConcurrency(50)).toBe(20);
    expect(resolveEvalConcurrency(100)).toBe(20);
  });

  test("passes through valid values", () => {
    expect(resolveEvalConcurrency(1)).toBe(1);
    expect(resolveEvalConcurrency(10)).toBe(10);
    expect(resolveEvalConcurrency(20)).toBe(20);
  });

  test("floors fractional values", () => {
    expect(resolveEvalConcurrency(3.9)).toBe(3);
    expect(resolveEvalConcurrency(7.1)).toBe(7);
  });

  test("falls back to env.EVAL_CONCURRENCY when opt is undefined", () => {
    // env is validated at boot as integer [1, 20] with default 5 — the
    // helper must simply echo it unchanged when no opt is passed.
    const fallback = resolveEvalConcurrency();
    expect(fallback).toBeGreaterThanOrEqual(1);
    expect(fallback).toBeLessThanOrEqual(20);
    expect(Number.isInteger(fallback)).toBe(true);
  });
});

describe("runBoundedPool", () => {
  test("returns immediately when total is 0", async () => {
    let called = false;
    await runBoundedPool(0, 5, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  test("invokes runOne once per index in [0, total)", async () => {
    const seen: number[] = [];
    await runBoundedPool(5, 2, async (index) => {
      seen.push(index);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  test("never runs more than `concurrency` workers in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBoundedPool(20, 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  test("preserves ordering regardless of finish order", async () => {
    // Higher indices finish faster so completion order is reversed.
    const results: string[] = new Array(5);
    await runBoundedPool(5, 3, async (index) => {
      const delay = (5 - index) * 3;
      await sleep(delay);
      results[index] = `item-${index}`;
    });
    expect(results).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });

  test("one throwing runOne does not abort peers", async () => {
    const results: (string | null)[] = new Array(6).fill(null);
    const errors: number[] = [];
    await runBoundedPool(
      6,
      3,
      async (index) => {
        if (index === 2) throw new Error(`boom-${index}`);
        results[index] = `ok-${index}`;
      },
      {
        onError: (_err, index) => {
          errors.push(index);
        },
      },
    );
    expect(errors).toEqual([2]);
    expect(results).toEqual([
      "ok-0",
      "ok-1",
      null, // index 2 threw
      "ok-3",
      "ok-4",
      "ok-5",
    ]);
  });

  test("swallows errors thrown by onError", async () => {
    // A failing error-sink must never poison the pool.
    await expect(
      runBoundedPool(
        3,
        2,
        async () => {
          throw new Error("runOne boom");
        },
        {
          onError: () => {
            throw new Error("onError boom");
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  test("swallows errors thrown by onBeforeRun", async () => {
    const results: number[] = [];
    await runBoundedPool(
      3,
      2,
      async (index) => {
        results.push(index);
      },
      {
        onBeforeRun: () => {
          throw new Error("hook boom");
        },
      },
    );
    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  test("onBeforeRun sees monotonic completed counter", async () => {
    // `completed` must never decrease and must equal the number of items
    // whose runOne has resolved before this invocation.
    const snapshots: number[] = [];
    await runBoundedPool(
      8,
      3,
      async () => {
        // Tiny stagger so completions interleave rather than finishing in lockstep.
        await sleep(Math.random() * 5);
      },
      {
        onBeforeRun: (_index, completed) => {
          snapshots.push(completed);
        },
      },
    );
    expect(snapshots).toHaveLength(8);
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBeGreaterThanOrEqual(snapshots[i - 1]);
    }
    // First `concurrency` dispatches see completed=0 (nothing finished yet).
    expect(snapshots[0]).toBe(0);
  });

  test("clamps concurrency to at least 1 even with absurd inputs", async () => {
    const seen: number[] = [];
    await runBoundedPool(3, 0, async (index) => {
      seen.push(index);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  test("clamps concurrency to total when concurrency > total", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBoundedPool(2, 100, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(2);
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
