/**
 * Integration tests for mg import-guardrails command.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentKnowledgeBase,
  agents,
  apiKeys,
  knowledgeBase,
  organizations,
  users,
} from "@db/schema";
import { eq } from "drizzle-orm";
import { handleAddAgents } from "../../../src/cli/commands/add-agents";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
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

  await handleAddUsers(orgId, [
    {
      email: "guardrail-admin@test.com",
      name: "Guardrail Admin",
      role: "admin",
    },
  ]);

  await handleAddAgents(orgId, [
    {
      name: "Guardrail Test Agent",
      slug: "guardrail-test-agent",
      modality: "voice",
      platform: "custom",
      active: false,
      tools: [],
    },
  ]);
});

afterAll(async () => {
  await forApp(async (tx) => {
    const orgGuardrails = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.organizationId, orgId));

    for (const guardrail of orgGuardrails) {
      await tx
        .delete(agentKnowledgeBase)
        .where(eq(agentKnowledgeBase.knowledgeBaseId, guardrail.id));
    }

    await tx
      .delete(knowledgeBase)
      .where(eq(knowledgeBase.organizationId, orgId));

    const orgAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.organizationId, orgId));

    for (const agent of orgAgents) {
      await tx.delete(apiKeys).where(eq(apiKeys.agentId, agent.id));
    }

    await tx.delete(agents).where(eq(agents.organizationId, orgId));
    await tx.delete(users).where(eq(users.organizationId, orgId));
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

  test("resolves agents without registry", async () => {
    const result = await handleImportGuardrails(orgId, [
      {
        name: "Standalone Guardrail",
        slug: "standalone-guardrail",
        content: "Stay within approved claims.",
        config: { priority: "high" },
        agents: ["guardrail-test-agent"],
      },
    ]);

    expect(result.created).toBe(1);

    const [guardrail] = await forApp(async (tx) => {
      return tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.slug, "standalone-guardrail"));
    });
    expect(guardrail).toBeDefined();

    const assignments = await forApp(async (tx) => {
      return tx
        .select()
        .from(agentKnowledgeBase)
        .where(eq(agentKnowledgeBase.knowledgeBaseId, guardrail!.id));
    });
    expect(assignments.length).toBe(1);
  });
});
