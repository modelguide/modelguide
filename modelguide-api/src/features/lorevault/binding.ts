/**
 * Single binding point for the LoreVault integration client.
 *
 * Application code imports `createLoreVaultClient` from here and never
 * names a concrete implementation. Swapping mock → HTTP after Wave 1
 * ships is one line: change `MockLoreVaultClient` to `HttpLoreVaultClient`
 * (constructor signature is compatible — both accept a config object that
 * the mock ignores).
 *
 * Phase 0 Integration Contract §3 — thin-adapter pattern.
 */

import type { LoreVaultIntegrationClient } from "./client";
import { MockLoreVaultClient } from "./mock-client";

export interface LoreVaultClientConfig {
  baseUrl?: string;
  apiKey?: string;
  knowledgeSpaceId?: string;
}

export function createLoreVaultClient(
  _config: LoreVaultClientConfig = {},
): LoreVaultIntegrationClient {
  // Wave 1 swap point — change this one line to:
  //   return new HttpLoreVaultClient({
  //     baseUrl: _config.baseUrl!,
  //     apiKey: _config.apiKey!,
  //     knowledgeSpaceId: _config.knowledgeSpaceId!,
  //   });
  return new MockLoreVaultClient();
}
