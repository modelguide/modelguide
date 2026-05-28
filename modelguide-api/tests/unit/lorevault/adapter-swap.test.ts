/**
 * Adapter swap test (Phase 0 Integration Contract §3).
 *
 * Asserts that:
 *   1. MockLoreVaultClient and HttpLoreVaultClient implement the same
 *      LoreVaultIntegrationClient interface — application code references
 *      only the interface and cannot tell them apart.
 *   2. Swapping the binding is structurally a single statement in
 *      `binding.ts` — no application-code change anywhere else.
 *   3. Method surface is identical: every method on the interface is
 *      present on both implementations.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LoreVaultIntegrationClient } from "@features/lorevault/client";
import { HttpLoreVaultClient } from "@features/lorevault/http-client";
import { MockLoreVaultClient } from "@features/lorevault/mock-client";

const REQUIRED_METHODS: Array<keyof LoreVaultIntegrationClient> = [
  "emitSignal",
  "emitSignalsBatch",
  "ingestDocuments",
  "getIngestionJob",
  "query",
  "listNarratives",
  "getNarrative",
  "getNarrativeEvidence",
  "getSignalEvidence",
  "getEntitlements",
  "getPacks",
  "getHealth",
];

describe("LoreVault adapter swap", () => {
  test("both implementations conform to LoreVaultIntegrationClient", () => {
    const mock: LoreVaultIntegrationClient = new MockLoreVaultClient();
    const http: LoreVaultIntegrationClient = new HttpLoreVaultClient({
      baseUrl: "https://example.invalid",
      apiKey: "k",
      knowledgeSpaceId: "ks",
    });
    expect(mock).toBeDefined();
    expect(http).toBeDefined();
  });

  test("every interface method exists on both implementations", () => {
    const mock = new MockLoreVaultClient() as unknown as Record<
      string,
      unknown
    >;
    const http = new HttpLoreVaultClient({
      baseUrl: "x",
      apiKey: "y",
      knowledgeSpaceId: "z",
    }) as unknown as Record<string, unknown>;
    for (const method of REQUIRED_METHODS) {
      expect(typeof mock[method]).toBe("function");
      expect(typeof http[method]).toBe("function");
    }
  });

  test("HttpLoreVaultClient throws the expected pre-Wave-1 message on every method", async () => {
    const http = new HttpLoreVaultClient({
      baseUrl: "x",
      apiKey: "y",
      knowledgeSpaceId: "z",
    });

    const calls: Array<Promise<unknown>> = [
      http.emitSignal({
        signal_id: "s",
        signal_version: "1",
        emitted_at: "",
        source_system: "",
        source_instance: "",
        knowledge_space_id: "",
        vault_id: "",
        event_type: "",
        entity: { type: "ticket", id: "1" },
        actor: { type: "ai_agent", id: "a" },
        declared_lens_hints: [],
        canonical_object_identity: {
          tenant_id: "",
          source_system: "",
          object_type: "",
          object_id: "",
        },
        payload: {},
      }),
      http.emitSignalsBatch([]),
      http.ingestDocuments({
        knowledge_space_id: "",
        dataset_id: "",
        documents: [],
      }),
      http.getIngestionJob("j"),
      http.query({ knowledge_space_id: "", match: {}, return: {} }),
      http.listNarratives({ knowledge_space_id: "" }),
      http.getNarrative("n"),
      http.getNarrativeEvidence("n"),
      http.getSignalEvidence("s"),
      http.getEntitlements(),
      http.getPacks(),
      http.getHealth(),
    ];

    for (const call of calls) {
      let err: unknown;
      try {
        await call;
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect((err as Error).message).toContain(
        "Not implemented; bound after Wave 1 ships.",
      );
    }
  });

  test("swap point in binding.ts is a single `new MockLoreVaultClient` statement", () => {
    const path = resolve(
      import.meta.dir,
      "../../../src/features/lorevault/binding.ts",
    );
    const source = readFileSync(path, "utf8");
    const matches = source.match(/new MockLoreVaultClient\b/g) ?? [];
    expect(matches.length).toBe(1);
    expect(source).toContain("change this one line");
  });
});
