/**
 * Integration tests for mg add-users command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import { organizations, users } from "@db/schema";
import { eq } from "drizzle-orm";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-users-test-${Date.now()}`;
let orgId: string;

beforeAll(async () => {
  const org = await handleCreateOrg({
    name: "CLI Users Test",
    slug: TEST_SLUG,
    demoEnabled: false,
  });
  orgId = org.id;
});

afterAll(async () => {
  await forApp(async (tx) => {
    await tx.delete(users).where(eq(users.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("add-users", () => {
  test("creates users with correct roles", async () => {
    const registry = new IdRegistry();
    const result = await handleAddUsers(
      orgId,
      [
        { email: "admin@cli-test.com", name: "Admin User", role: "admin" },
        {
          email: "support@cli-test.com",
          name: "Support User",
          role: "support",
        },
      ],
      registry,
    );

    expect(result.created).toBe(2);
    expect(result.existing).toBe(0);
    expect(registry.has("user", "admin@cli-test.com")).toBe(true);
    expect(registry.has("user", "support@cli-test.com")).toBe(true);
  });

  test("handles duplicate users gracefully", async () => {
    const result = await handleAddUsers(orgId, [
      { email: "admin@cli-test.com", name: "Admin User", role: "admin" },
    ]);

    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
  });
});
