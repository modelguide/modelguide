/**
 * Secrets service - business logic for encrypted credentials management
 */

import { forOrg } from "@db/rls";
import { secrets } from "@db/schema";
import { encryptSecret } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { getOffset } from "@lib/pagination";
import { count, eq } from "drizzle-orm";

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

export async function listSecrets(
  orgId: string,
  pagination: { page: number; pageSize: number },
): Promise<{ items: (typeof secretColumns)[]; total: number }> {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const [items, [{ total }]] = await Promise.all([
      tx.select(secretColumns).from(secrets).limit(pageSize).offset(offset),
      tx.select({ total: count() }).from(secrets),
    ]);

    return { items, total };
  });
}

export async function createSecret(
  orgId: string,
  data: {
    name: string;
    value: string;
    secretType: "api_key" | "oauth_token" | "credentials";
    ownerType: "connector";
    ownerId: string;
  },
) {
  const encryptedValue = await encryptSecret(data.value);

  const [created] = await forOrg(orgId, (tx) =>
    tx
      .insert(secrets)
      .values({
        organizationId: orgId,
        name: data.name,
        secretType: data.secretType,
        encryptedValue,
        ownerType: data.ownerType,
        ownerId: data.ownerId,
      })
      .returning(secretColumns),
  );

  return created;
}

export async function getSecretById(orgId: string, secretId: string) {
  const [secret] = await forOrg(orgId, (tx) =>
    tx
      .select(secretColumns)
      .from(secrets)
      .where(eq(secrets.id, secretId))
      .limit(1),
  );

  if (!secret) {
    throw Errors.notFound("Secret", secretId);
  }

  return secret;
}

export async function updateSecret(
  orgId: string,
  secretId: string,
  data: { name?: string; value?: string },
) {
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
