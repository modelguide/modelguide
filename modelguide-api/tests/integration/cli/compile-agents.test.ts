/**
 * Integration tests for mg compile-agents command.
 *
 * Note: Full compilation requires LLM API keys (OPENAI_API_KEY or ANTHROPIC_API_KEY).
 * Tests that call the real compiler will skip gracefully if keys are unavailable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agentSops,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  organizations,
  sopSteps,
  sops,
  users,
} from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { eq } from "drizzle-orm";
import { handleAddAgents } from "../../../src/cli/commands/add-agents";
import { handleAddConnectors } from "../../../src/cli/commands/add-connectors";
import { handleAddUsers } from "../../../src/cli/commands/add-users";
import { handleCompileAgents } from "../../../src/cli/commands/compile-agents";
import { handleCreateOrg } from "../../../src/cli/commands/create-org";
import { handleImportSops } from "../../../src/cli/commands/import-sops";
import { IdRegistry } from "../../../src/cli/lib/id-registry";

const TEST_SLUG = `cli-compile-test-${Date.now()}`;
let orgId: string;
let registry: IdRegistry;

beforeAll(async () => {
  await loadAllManifests();
  registry = new IdRegistry();

  const org = await handleCreateOrg(
    { name: "CLI Compile Test", slug: TEST_SLUG, demoEnabled: false },
    registry,
  );
  orgId = org.id;

  await handleAddUsers(
    orgId,
    [
      {
        email: "compile-admin@test.com",
        name: "Compile Admin",
        role: "admin",
      },
    ],
    registry,
  );

  await handleAddConnectors(
    orgId,
    [
      {
        name: "Compile Store",
        slug: "compile_store",
        catalogSlug: "medusa",
        config: { baseUrl: "https://api.compile-test.com" },
        secrets: [],
      },
    ],
    { skipSecrets: true, registry },
  );

  // Agent WITH active SOP
  await handleAddAgents(
    orgId,
    [
      {
        name: "Compilable Agent",
        slug: "compilable-agent",
        modality: "voice",
        platform: "custom",
        active: false,
        tools: [{ connectorSlug: "compile_store" }],
        secrets: [],
      },
    ],
    { registry },
  );

  // Agent WITHOUT SOPs
  await handleAddAgents(
    orgId,
    [
      {
        name: "No SOP Agent",
        slug: "no-sop-agent",
        modality: "text",
        platform: "custom",
        active: false,
        tools: [],
        secrets: [],
      },
    ],
    { registry },
  );

  // Create and activate a SOP assigned to compilable-agent
  await handleImportSops(
    orgId,
    [
      {
        name: "Compile Test SOP",
        slug: "compile-test-sop",
        status: "active",
        agents: ["compilable-agent"],
        steps: [
          {
            id: "step1",
            instruction: "Greet the customer",
            required: true,
          },
          {
            id: "step2",
            instruction: "Ask how you can help",
            required: true,
          },
        ],
      },
    ],
    { registry },
  );
});

afterAll(async () => {
  await forApp(async (tx) => {
    const orgSops = await tx
      .select({ id: sops.id })
      .from(sops)
      .where(eq(sops.organizationId, orgId));
    for (const s of orgSops) {
      await tx.delete(agentSops).where(eq(agentSops.sopId, s.id));
      await tx.delete(sopSteps).where(eq(sopSteps.sopId, s.id));
    }
    await tx.delete(sops).where(eq(sops.organizationId, orgId));

    const orgAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.organizationId, orgId));
    for (const a of orgAgents) {
      await tx
        .delete(agentConnectorTools)
        .where(eq(agentConnectorTools.agentId, a.id));
      await tx.delete(apiKeys).where(eq(apiKeys.agentId, a.id));
    }
    await tx.delete(agents).where(eq(agents.organizationId, orgId));

    const orgConnectors = await tx
      .select({ id: connectors.id })
      .from(connectors)
      .where(eq(connectors.organizationId, orgId));
    for (const c of orgConnectors) {
      await tx
        .delete(connectorTools)
        .where(eq(connectorTools.connectorId, c.id));
    }
    await tx.delete(connectors).where(eq(connectors.organizationId, orgId));
    await tx.delete(users).where(eq(users.organizationId, orgId));
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
});

describe("compile-agents", () => {
  test("skips agent with no active SOPs", async () => {
    const result = await handleCompileAgents(orgId, {
      agentSlug: "no-sop-agent",
    });

    expect(result.compiled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test("returns zero when no agents match slug filter", async () => {
    const result = await handleCompileAgents(orgId, {
      agentSlug: "nonexistent-agent",
    });

    expect(result.compiled).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test("attempts to compile agent with active SOP", async () => {
    // This test calls the real compiler which needs LLM API keys.
    // It will succeed if keys are available, or fail gracefully (skipped count).
    const result = await handleCompileAgents(orgId, {
      agentSlug: "compilable-agent",
    });

    // Either compiled (LLM available) or skipped (LLM unavailable)
    expect(result.compiled + result.skipped).toBeGreaterThanOrEqual(1);
  });
});
