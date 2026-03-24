/**
 * Integration tests for mg import-guardrails command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import { knowledgeBase, organizations } from "@db/schema";
import { eq } from "drizzle-orm";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { handleImportGuardrails } from "../../../src/cli/commands/import-guardrails";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-guard-test-${Date.now()}`;
let orgId: string;

beforeAll(async () => {
  const org = await handleCreateOrg({
    name: "CLI Guardrails Test",
    slug: TEST_SLUG,
    demoEnabled: false,
  });
  orgId = org.id;
});

afterAll(async () => {
  await forApp(async (tx) => {
    await tx
      .delete(knowledgeBase)
      .where(eq(knowledgeBase.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("import-guardrails", () => {
  test("creates guardrails", async () => {
    const registry = new IdRegistry();
    const result = await handleImportGuardrails(
      orgId,
      [
        {
          name: "No Medical Claims",
          slug: "no-medical-claims",
          content: "Never claim products cure diseases.",
          config: { priority: "critical" },
          agents: [],
        },
      ],
      { registry },
    );

    expect(result.created).toBe(1);
    expect(result.existing).toBe(0);
    expect(registry.has("guardrail", "no-medical-claims")).toBe(true);
  });

  test("handles duplicate guardrails gracefully", async () => {
    const result = await handleImportGuardrails(orgId, [
      {
        name: "No Medical Claims",
        slug: "no-medical-claims",
        content: "Never claim products cure diseases.",
        config: {},
        agents: [],
      },
    ]);

    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
  });
});
