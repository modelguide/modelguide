/**
 * Integration tests for mg create-org command.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import { organizations } from "@db/schema";
import { eq } from "drizzle-orm";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-test-org-${Date.now()}`;

afterAll(async () => {
  await forApp(async (tx) => {
    await tx.delete(organizations).where(eq(organizations.slug, TEST_SLUG));
  });
});

describe("create-org", () => {
  test("creates an organization", async () => {
    const result = await handleCreateOrg({
      name: "CLI Test Org",
      slug: TEST_SLUG,
      demoEnabled: false,
    });

    expect(result.name).toBe("CLI Test Org");
    expect(result.slug).toBe(TEST_SLUG);
    expect(result.id).toBeTruthy();
  });

  test("is idempotent (upserts on re-run)", async () => {
    const result = await handleCreateOrg({
      name: "CLI Test Org Updated",
      slug: TEST_SLUG,
      demoEnabled: true,
    });

    expect(result.slug).toBe(TEST_SLUG);
    expect(result.name).toBe("CLI Test Org Updated");
  });

  test("populates IdRegistry", async () => {
    const registry = new IdRegistry();
    const result = await handleCreateOrg(
      { name: "CLI Test Org", slug: TEST_SLUG, demoEnabled: false },
      registry,
    );

    expect(registry.has("org", TEST_SLUG)).toBe(true);
    expect(registry.get("org", TEST_SLUG)).toBe(result.id);
  });
});
