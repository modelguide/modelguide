/**
 * Public surface of the lorevault feature.
 *
 * Application code should depend ONLY on the interface + binding here.
 * Never import a concrete client directly — that defeats the adapter
 * swap (Phase 0 §3).
 */

export * from "./client";
export { createLoreVaultClient } from "./binding";
export type { LoreVaultClientConfig } from "./binding";
