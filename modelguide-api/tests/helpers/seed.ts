/**
 * Test seed data lookup helper.
 * Looks up data created by src/db/seed (run in integration-preload).
 * Caches results so DB is queried only once across all test files.
 */

import type { AuthUser } from "@/types";
import { forApp } from "@db/rls";
import {
  agents,
  apiKeys,
  connectors,
  connectorsCatalog,
  organizations,
  secrets,
  sessions,
  users,
} from "@db/schema";
import { generateJWT } from "@lib/jwt";
import { and, eq } from "drizzle-orm";

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "support";
  organizationId: string;
  isActive: boolean;
}

export interface SeedOrg {
  id: string;
  name: string;
  slug: string;
}

export interface TestSeed {
  pizzaOrg: SeedOrg;
  burgerOrg: SeedOrg;
  pizzaAdmin: SeedUser;
  pizzaSupport: SeedUser;
  pizzaInactive: SeedUser;
  burgerAdmin: SeedUser;
  burgerSupport: SeedUser;
  burgerInactive: SeedUser;
  catalogId: string;
  pizzaConnectorId: string;
  burgerConnectorId: string;
  pizzaAgentId: string;
  burgerAgentId: string;
}

let _cache: TestSeed | null = null;

export async function getTestSeed(): Promise<TestSeed> {
  if (_cache) return _cache;

  _cache = await forApp(async (tx) => {
    const [pizzaOrg] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, "pizza-palace"));
    const [burgerOrg] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, "burger-barn"));

    const lookupUser = async (orgId: string, email: string) => {
      const [u] = await tx
        .select()
        .from(users)
        .where(and(eq(users.organizationId, orgId), eq(users.email, email)));
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role as "admin" | "support",
        organizationId: u.organizationId,
        isActive: u.isActive,
      };
    };

    const pizzaAdmin = await lookupUser(
      pizzaOrg.id,
      "admin@pizza-palace.com",
    );
    const pizzaSupport = await lookupUser(
      pizzaOrg.id,
      "support@pizza-palace.com",
    );
    const pizzaInactive = await lookupUser(
      pizzaOrg.id,
      "inactive@pizza-palace.com",
    );
    const burgerAdmin = await lookupUser(
      burgerOrg.id,
      "admin@burger-barn.com",
    );
    const burgerSupport = await lookupUser(
      burgerOrg.id,
      "support@burger-barn.com",
    );
    const burgerInactive = await lookupUser(
      burgerOrg.id,
      "inactive@burger-barn.com",
    );

    const [catalog] = await tx
      .select()
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.slug, "medusa"));

    const [pizzaConnector] = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, pizzaOrg.id),
          eq(connectors.slug, "pizzapalace"),
        ),
      );
    const [burgerConnector] = await tx
      .select()
      .from(connectors)
      .where(
        and(
          eq(connectors.organizationId, burgerOrg.id),
          eq(connectors.slug, "burgerbarn"),
        ),
      );

    const [pizzaAgent] = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.organizationId, pizzaOrg.id),
          eq(agents.name, "pizza-palace Order Agent"),
        ),
      );
    const [burgerAgent] = await tx
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.organizationId, burgerOrg.id),
          eq(agents.name, "burger-barn Order Agent"),
        ),
      );

    return {
      pizzaOrg: { id: pizzaOrg.id, name: pizzaOrg.name, slug: pizzaOrg.slug },
      burgerOrg: {
        id: burgerOrg.id,
        name: burgerOrg.name,
        slug: burgerOrg.slug,
      },
      pizzaAdmin,
      pizzaSupport,
      pizzaInactive,
      burgerAdmin,
      burgerSupport,
      burgerInactive,
      catalogId: catalog.id,
      pizzaConnectorId: pizzaConnector.id,
      burgerConnectorId: burgerConnector.id,
      pizzaAgentId: pizzaAgent.id,
      burgerAgentId: burgerAgent.id,
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
