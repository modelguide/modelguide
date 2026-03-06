/**
 * Secrets service - business logic for encrypted credentials management
 */

import { forOrg } from "@db/rls";
import { agents, secrets } from "@db/schema";
import type { EntitySecretsMap } from "@db/schema";
import { decryptSecret, encryptSecret } from "@lib/crypto";
import { Errors, logAndThrow } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { asc, count, eq, isNull, or } from "drizzle-orm";

export type SecretScope = "connector" | "agent";

/**
 * Metadata columns returned for all secret queries.
 * The encrypted value is intentionally excluded.
 */
const secretColumns = {
  id: secrets.id,
  name: secrets.name,
  secretType: secrets.secretType,
  scope: secrets.scope,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
} as const;

export async function listSecrets(
  orgId: string,
  pagination: PaginationParams,
  filters?: {
    scope?: SecretScope;
    includeUnscoped?: boolean;
  },
) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    let whereClause = undefined;

    if (filters?.scope) {
      if (filters.includeUnscoped) {
        // scope match OR unscoped — scoped rows ordered first via orderBy
        whereClause = or(
          eq(secrets.scope, filters.scope),
          isNull(secrets.scope),
        );
      } else {
        whereClause = eq(secrets.scope, filters.scope);
      }
    }
    // no scope filter → return all

    // When includeUnscoped: put scoped (non-null) rows first, unscoped (null) last
    const orderClauses =
      filters?.scope && filters.includeUnscoped
        ? ([asc(secrets.scope), asc(secrets.createdAt)] as const)
        : ([asc(secrets.createdAt)] as const);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select(secretColumns)
        .from(secrets)
        .where(whereClause)
        .orderBy(...orderClauses)
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(secrets).where(whereClause),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getSecretById(orgId: string, secretId: string) {
  const [secret] = await forOrg(orgId, (tx) =>
    tx.select(secretColumns).from(secrets).where(eq(secrets.id, secretId)),
  );

  if (!secret) {
    throw Errors.notFound("Secret", secretId);
  }

  return secret;
}

export async function createSecret(
  orgId: string,
  data: {
    name: string;
    value: string;
    secretType:
      | "api_key"
      | "oauth_token"
      | "credentials"
      | "platform_api_key"
      | "webhook_secret";
    scope?: SecretScope;
  },
) {
  const encryptedValue = await encryptSecret(data.value);

  const [created] = await forOrg(orgId, async (tx) => {
    return tx
      .insert(secrets)
      .values({
        organizationId: orgId,
        name: data.name,
        secretType: data.secretType,
        encryptedValue,
        scope: data.scope ?? null,
      })
      .returning(secretColumns);
  });

  getLogger().info(
    {
      secretId: created.id,
      secretType: data.secretType,
      scope: data.scope ?? null,
    },
    "secret created",
  );

  return created;
}

/**
 * Get a decrypted agent secret by field name key.
 * Reads agent.secrets map → fetches secret UUID from org vault → decrypts.
 * Returns string | null (null if key absent or secret not in vault).
 */
export async function getAgentSecretByType(
  orgId: string,
  agentId: string,
  fieldName: string,
): Promise<string | null> {
  const [agentRow] = await forOrg(orgId, (tx) =>
    tx
      .select({ secrets: agents.secrets })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1),
  );

  if (!agentRow) return null;

  const secretsMap = (agentRow.secrets ?? {}) as EntitySecretsMap;
  const secretId = secretsMap[fieldName];
  if (!secretId) return null;

  const [secretRow] = await forOrg(orgId, (tx) =>
    tx
      .select({ encryptedValue: secrets.encryptedValue })
      .from(secrets)
      .where(eq(secrets.id, secretId))
      .limit(1),
  );

  if (!secretRow) return null;

  try {
    return await decryptSecret(secretRow.encryptedValue);
  } catch (err) {
    logAndThrow(
      getLogger(),
      err,
      { agentId, fieldName, secretId },
      "failed to decrypt agent secret",
    );
  }
}

/**
 * Get decrypted ElevenLabs API key for an agent.
 * Resolves from agent.secrets["platform_api_key"].
 */
export async function getAgentElevenLabsKey(
  orgId: string,
  agentId: string,
): Promise<string | null> {
  return getAgentSecretByType(orgId, agentId, "platform_api_key");
}

/**
 * Get decrypted ModelGuide API key for an agent.
 * Resolves from agent.secrets["api_key"].
 */
export async function getAgentModelGuideKey(
  orgId: string,
  agentId: string,
): Promise<string | null> {
  return getAgentSecretByType(orgId, agentId, "api_key");
}

export async function updateSecret(
  orgId: string,
  secretId: string,
  data: { name?: string; value?: string },
) {
  if (data.name === undefined && data.value === undefined) {
    throw Errors.validationError(
      "At least one of 'name' or 'value' must be provided",
    );
  }

  const updateData: { name?: string; encryptedValue?: string } = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
  }

  if (data.value !== undefined) {
    updateData.encryptedValue = await encryptSecret(data.value);
  }

  const [updated] = await forOrg(orgId, (tx) =>
    tx
      .update(secrets)
      .set(updateData)
      .where(eq(secrets.id, secretId))
      .returning(secretColumns),
  );

  if (!updated) {
    throw Errors.notFound("Secret", secretId);
  }

  return updated;
}

export async function deleteSecret(
  orgId: string,
  secretId: string,
): Promise<void> {
  const [deleted] = await forOrg(orgId, (tx) =>
    tx
      .delete(secrets)
      .where(eq(secrets.id, secretId))
      .returning({ id: secrets.id }),
  );

  if (!deleted) {
    throw Errors.notFound("Secret", secretId);
  }

  getLogger().info({ secretId }, "secret deleted");
}
