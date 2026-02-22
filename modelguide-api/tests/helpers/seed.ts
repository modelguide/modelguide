/**
 * Test seed data lookup helper.
 * Looks up data created by src/db/seed (run in integration-preload).
 * Caches results so DB is queried only once across all test files.
 *
 * Uses generic orgA/orgB naming so tests are org-name-agnostic.
 * orgA = GlowBox Beauty (glowbox, demoEnabled), orgB = ClearHealth (clearhealth).
 */

import type { AuthUser } from "@/types";
import { forApp } from "@db/rls";
import {
  agents,
  apiKeys,
  connectors,
  connectorsCatalog,
  organizations,
  users,
} from "@db/schema";
import { generateApiKey } from "@lib/crypto";
import { generateJWT } from "@lib/jwt";
import { and, eq } from "drizzle-orm";

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "support" | "viewer";
  organizationId: string;
  isActive: boolean;
}

export interface SeedOrg {
  id: string;
  name: string;
  slug: string;
}

export interface TestSeed {
  orgA: SeedOrg;
  orgB: SeedOrg;
  /** Demo org (same as orgA — GlowBox has demoEnabled=true) */
  demoOrg: SeedOrg;
  orgAAdmin: SeedUser;
  orgASupport: SeedUser;
  orgAInactive: SeedUser;
  orgBAdmin: SeedUser;
  orgBSupport: SeedUser;
  orgBInactive: SeedUser;
  /** Demo viewer (viewer user in demo-enabled orgA) */
  demoViewer: SeedUser;
  medusaCatalogId: string;
  zendeskCatalogId: string;
  orgAMedusaConnectorId: string;
  orgAZendeskConnectorId: string;
  orgBMedusaConnectorId: string;
  orgBZendeskConnectorId: string;
  orgAAgentId: string;
  orgBAgentId: string;
}

let _cache: TestSeed | null = null;

export async function getTestSeed(): Promise<TestSeed> {
  if (_cache) return _cache;

  _cache = await forApp(async (tx) => {
    const [orgA] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, "glowbox"));
    const [orgB] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, "clearhealth"));

    const lookupUser = async (orgId: string, email: string) => {
      const [u] = await tx
        .select()
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.email, email)));
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role as "admin" | "support" | "viewer",
        organizationId: u.organizationId,
        isActive: u.isActive,
      };
    };

    const orgAAdmin = await lookupUser(
      orgA.id,
      "delivered+admin-glowbox@resend.dev",
    );
    const orgASupport = await lookupUser(
      orgA.id,
      "delivered+support-glowbox@resend.dev",
    );
    const orgAInactive = await lookupUser(
      orgA.id,
      "delivered+inactive-glowbox@resend.dev",
    );
    const orgBAdmin = await lookupUser(
      orgB.id,
      "delivered+admin-clearhealth@resend.dev",
    );
    const orgBSupport = await lookupUser(
      orgB.id,
      "delivered+support-clearhealth@resend.dev",
    );
    const orgBInactive = await lookupUser(
      orgB.id,
      "delivered+inactive-clearhealth@resend.dev",
    );
    const demoViewer = await lookupUser(
      orgA.id,
      "demo-viewer-glowbox@modelguide.dev",
    );

    const [medusaCatalog] = await tx
      .select()
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));
    const [zendeskCatalog] = await tx
      .select()
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "zendesk"));

    const [orgAMedusaConnector] = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, orgA.id),
          eq(connectors.slug, "glowbox_store"),
        ),
      );
    const [orgAZendeskConnector] = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, orgA.id),
          eq(connectors.slug, "glowbox_support"),
        ),
      );
    const [orgBMedusaConnector] = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, orgB.id),
          eq(connectors.slug, "clearhealth_pharmacy"),
        ),
      );
    const [orgBZendeskConnector] = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, orgB.id),
          eq(connectors.slug, "clearhealth_support"),
        ),
      );

    const [orgAAgent] = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.organizationId, orgA.id),
          eq(agents.name, "GlowBox Voice Concierge"),
        ),
      );
    const [orgBAgent] = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.organizationId, orgB.id),
          eq(agents.name, "ClearHealth Phone Assistant"),
        ),
      );

    return {
      orgA: { id: orgA.id, name: orgA.name, slug: orgA.slug },
      orgB: { id: orgB.id, name: orgB.name, slug: orgB.slug },
      demoOrg: { id: orgA.id, name: orgA.name, slug: orgA.slug },
      orgAAdmin,
      orgASupport,
      orgAInactive,
      orgBAdmin,
      orgBSupport,
      orgBInactive,
      demoViewer,
      medusaCatalogId: medusaCatalog.id,
      zendeskCatalogId: zendeskCatalog.id,
      orgAMedusaConnectorId: orgAMedusaConnector.id,
      orgAZendeskConnectorId: orgAZendeskConnector.id,
      orgBMedusaConnectorId: orgBMedusaConnector.id,
      orgBZendeskConnectorId: orgBZendeskConnector.id,
      orgAAgentId: orgAAgent.id,
      orgBAgentId: orgBAgent.id,
    };
  });

  return _cache;
}

/** Build Authorization + Content-Type headers from a seed user. */
export async function authHeadersFor(
  user: SeedUser,
): Promise<Record<string, string>> {
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  };
  const jwt = await generateJWT(authUser);
  return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
}

/**
 * Cache of generated agent API keys (agentId → raw key).
 * We create a fresh API key per agent since raw keys are not stored in DB.
 */
const _agentKeyCache = new Map<string, string>();

/** Build Authorization + Content-Type headers for an agent (API key auth). */
export async function agentHeadersFor(
  agentId: string,
  organizationId: string,
): Promise<Record<string, string>> {
  let rawKey = _agentKeyCache.get(agentId);

  if (!rawKey) {
    const generated = generateApiKey();
    rawKey = generated.key;

    await forApp(async (tx) => {
      await tx.insert(apiKeys).values({
        organizationId,
        agentId,
        name: `test-key-${agentId.slice(0, 8)}`,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        isActive: true,
      });
    });

    _agentKeyCache.set(agentId, rawKey);
  }

  return {
    Authorization: `Bearer ${rawKey}`,
    "Content-Type": "application/json",
  };
}
