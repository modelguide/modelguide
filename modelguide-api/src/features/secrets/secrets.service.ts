/**
 * Secrets service - business logic for encrypted credentials management
 */

import { forOrg } from "@db/rls";
import { agents, connectors, secrets } from "@db/schema";
import { decryptSecret, encryptSecret } from "@lib/crypto";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, eq } from "drizzle-orm";

/**
 * Metadata columns returned for all secret queries.
 * The encrypted value is intentionally excluded.
 */
const secretColumns = {
  id: secrets.id,
  name: secrets.name,
  secretType: secrets.secretType,
  ownerType: secrets.ownerType,
  ownerId: secrets.ownerId,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
} as const;

export async function listSecrets(orgId: string, pagination: PaginationParams) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const [items, [{ total }]] = await Promise.all([
      tx
        .select(secretColumns)
        .from(secrets)
        .orderBy(asc(secrets.createdAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(secrets),
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
    secretType: "api_key" | "oauth_token" | "credentials";
    ownerType: "connector" | "agent";
    ownerId: string;
  },
) {
  const encryptedValue = await encryptSecret(data.value);

  const [created] = await forOrg(orgId, async (tx) => {
    // Validate that the referenced owner exists within the same org (RLS-scoped)
    if (data.ownerType === "connector") {
      const [owner] = await tx
        .select({ id: connectors.id })
        .from(connectors)
        .where(eq(connectors.id, data.ownerId));
      if (!owner) {
        throw Errors.notFound("Connector", data.ownerId);
      }
    } else if (data.ownerType === "agent") {
      const [owner] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.id, data.ownerId));
      if (!owner) {
        throw Errors.notFound("Agent", data.ownerId);
      }
    }

    return tx
      .insert(secrets)
      .values({
        organizationId: orgId,
        name: data.name,
        secretType: data.secretType,
        encryptedValue,
        ownerType: data.ownerType,
        ownerId: data.ownerId,
      })
      .returning(secretColumns);
  });

  return created;
}

/**
 * Get decrypted ElevenLabs API key for an agent.
 */
export async function getAgentElevenLabsKey(
  orgId: string,
  agentId: string,
): Promise<string | null> {
  const [secret] = await forOrg(orgId, (tx) =>
    tx
      .select({ encryptedValue: secrets.encryptedValue })
      .from(secrets)
      .where(
        and(eq(secrets.ownerType, "agent"), eq(secrets.ownerId, agentId)),
      )
      .limit(1),
  );

  if (!secret) return null;
  return decryptSecret(secret.encryptedValue);
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
}
