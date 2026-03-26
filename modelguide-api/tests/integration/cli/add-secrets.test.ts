/**
 * Integration tests for mg add-secrets command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import { organizations, secrets } from "@db/schema";
import { eq } from "drizzle-orm";
import { handleAddSecrets } from "../../../src/cli/commands/add-secrets";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-secrets-test-${Date.now()}`;
let orgId: string;

beforeAll(async () => {
  const org = await handleCreateOrg({
    name: "CLI Secrets Test",
    slug: TEST_SLUG,
    demoEnabled: false,
  });
  orgId = org.id;
});

afterAll(async () => {
  await forApp(async (tx) => {
    await tx.delete(secrets).where(eq(secrets.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("add-secrets", () => {
  test("creates secrets with explicit values", async () => {
    const registry = new IdRegistry();
    const result = await handleAddSecrets(
      orgId,
      [
        {
          name: "Test API Key",
          value: "sk-test-12345",
          type: "api_key",
          scope: "connector",
        },
        {
          name: "Test OAuth Token",
          value: "oauth-token-abc",
          type: "oauth_token",
        },
      ],
      { registry },
    );

    expect(result.created).toBe(2);
    expect(result.existing).toBe(0);
    expect(registry.has("secret", "Test API Key")).toBe(true);
    expect(registry.has("secret", "Test OAuth Token")).toBe(true);
  });

  test("uses placeholder when skipSecrets and no value", async () => {
    const result = await handleAddSecrets(
      orgId,
      [{ name: "Placeholder Secret", type: "api_key" }],
      { skipSecrets: true },
    );

    expect(result.created).toBe(1);
  });

  test("creates multiple secrets of same type", async () => {
    // Secrets have no unique constraint on name — duplicates are allowed
    const result = await handleAddSecrets(orgId, [
      {
        name: "Another API Key",
        value: "sk-test-99999",
        type: "api_key",
        scope: "agent",
      },
    ]);

    expect(result.created).toBe(1);
  });
});
