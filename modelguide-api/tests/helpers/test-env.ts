/**
 * Type-safe env override for tests.
 *
 * Encapsulates env mutation in one place so test files don't need
 * unsafe casts. Saves originals automatically and restores on cleanup.
 */

import { type Env, env } from "@/env";

const saved = new Map<keyof Env, unknown>();

/**
 * Override an env variable for the duration of a test.
 * Call `restoreEnv()` in afterEach/afterAll to undo all overrides.
 */
export function overrideEnv<K extends keyof Env>(key: K, value: Env[K]): void {
  if (!saved.has(key)) {
    saved.set(key, env[key]);
  }
  // env is a plain Zod-parsed object — mutable at runtime
  Object.defineProperty(env, key, {
    value,
    writable: true,
    configurable: true,
  });
}

/** Restore all overridden env variables to their original values. */
export function restoreEnv(): void {
  for (const [key, val] of saved) {
    Object.defineProperty(env, key, {
      value: val,
      writable: true,
      configurable: true,
    });
  }
  saved.clear();
}
