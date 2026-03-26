/**
 * Integration test for mg setup — full pipeline.
 * Creates an org with users, connectors, agents, guardrails.
 * Verifies second run is idempotent.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { forApp } from "@db/rls";
import {
  agentConnectorTools,
  agents,
  apiKeys,
  connectorTools,
  connectors,
  knowledgeBase,
  organizations,
  secrets,
  users,
} from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { eq } from "drizzle-orm";
import { handleSetup } from "../../../src/cli/commands/setup";

const TEST_SLUG = `cli-setup-test-${Date.now()}`;
let tmpDir: string;
let orgId: string;

beforeAll(async () => {
  await loadAllManifests();

  // Create temp directory with YAML files
  tmpDir = mkdtempSync(path.join(tmpdir(), "cli-setup-"));

  writeFileSync(
    path.join(tmpDir, "org.yaml"),
    `name: "Setup Test Org"
slug: "${TEST_SLUG}"
demoEnabled: false
`,
  );

  writeFileSync(
    path.join(tmpDir, "users.yaml"),
    `users:
  - email: setup-admin@test.com
    name: "Setup Admin"
    role: admin
  - email: setup-support@test.com
    name: "Setup Support"
    role: support
`,
  );

  writeFileSync(
    path.join(tmpDir, "connectors.yaml"),
    `connectors:
  - name: "Setup Store"
    slug: "setup_store"
    catalogSlug: "medusa"
    config:
      baseUrl: "https://api.setup-test.com"
    secrets:
      - field: "apiKey"
        name: "Setup Store Key"
        type: api_key
`,
  );

  writeFileSync(
    path.join(tmpDir, "agents.yaml"),
    `agents:
  - name: "Setup Voice Agent"
    slug: "setup-voice-agent"
    modality: voice
    tools:
      - connectorSlug: "setup_store"
`,
  );

  writeFileSync(
    path.join(tmpDir, "guardrails.yaml"),
    `guardrails:
  - name: "Setup Guardrail"
    slug: "setup-guardrail"
    content: "Do not make false claims."
    config:
      priority: high
    agents:
      - "setup-voice-agent"
`,
  );
});

afterAll(async () => {
  rmSync(tmpDir, { recursive: true });

  if (orgId) {
    await forApp(async (tx) => {
      // Clean up in dependency order
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
      await tx.delete(secrets).where(eq(secrets.organizationId, orgId));
      await tx
        .delete(knowledgeBase)
        .where(eq(knowledgeBase.organizationId, orgId));
      await tx.delete(users).where(eq(users.organizationId, orgId));
      await tx.delete(organizations).where(eq(organizations.id, orgId));
    });
  }
});

describe("mg setup", () => {
  test("dry-run validates without creating anything", async () => {
    await handleSetup(tmpDir, { dryRun: true, skipSecrets: true });

    // Verify no org was created
    const [org] = await forApp(async (tx) => {
      return tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, TEST_SLUG));
    });
    expect(org).toBeUndefined();
  });

  test("creates full pipeline", async () => {
    await handleSetup(tmpDir, {
      skipSecrets: true,
      skipCompile: true,
      skipSessions: true,
    });

    // Verify org exists
    const [org] = await forApp(async (tx) => {
      return tx
        .select()
        .from(organizations)
        .where(eq(organizations.slug, TEST_SLUG));
    });
    expect(org).toBeDefined();
    orgId = org!.id;

    // Verify users
    const orgUsers = await forApp(async (tx) => {
      return tx.select().from(users).where(eq(users.organizationId, orgId));
    });
    expect(orgUsers.length).toBe(2);

    // Verify connector
    const orgConnectors = await forApp(async (tx) => {
      return tx
        .select()
        .from(connectors)
        .where(eq(connectors.organizationId, orgId));
    });
    expect(orgConnectors.length).toBe(1);
    expect(orgConnectors[0].slug).toBe("setup_store");

    // Verify agent
    const orgAgents = await forApp(async (tx) => {
      return tx.select().from(agents).where(eq(agents.organizationId, orgId));
    });
    expect(orgAgents.length).toBe(1);
    expect(orgAgents[0].slug).toBe("setup-voice-agent");

    // Verify guardrail
    const orgGuardrails = await forApp(async (tx) => {
      return tx
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.organizationId, orgId));
    });
    expect(orgGuardrails.length).toBe(1);
  });

  test("second run is idempotent", async () => {
    // Running again should not fail (finds existing entities)
    await handleSetup(tmpDir, {
      skipSecrets: true,
      skipCompile: true,
      skipSessions: true,
    });

    // Verify still same counts
    const orgUsers = await forApp(async (tx) => {
      return tx.select().from(users).where(eq(users.organizationId, orgId));
    });
    expect(orgUsers.length).toBe(2);
  });
});
