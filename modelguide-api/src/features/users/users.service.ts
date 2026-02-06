import { forOrg } from "@db/rls";
import { users } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { count, eq } from "drizzle-orm";

export async function listUsers(orgId: string, pagination: PaginationParams) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const [items, [{ total }]] = await Promise.all([
      tx.select().from(users).limit(pageSize).offset(offset),
      tx.select({ total: count() }).from(users),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getUserById(orgId: string, userId: string) {
  const result = await forOrg(orgId, async (tx) => {
    return tx.select().from(users).where(eq(users.id, userId));
  });

  if (result.length === 0) {
    throw Errors.userNotFound(userId);
  }

  return result[0];
}

export async function createUser(
  orgId: string,
  data: { email: string; name: string; role: "admin" | "support" },
) {
  try {
    const result = await forOrg(orgId, async (tx) => {
      return tx
        .insert(users)
        .values({
          organizationId: orgId,
          email: data.email.toLowerCase(),
          name: data.name,
          role: data.role,
        })
        .returning();
    });

    return result[0];
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes("users_org_email_unique")
    ) {
      throw Errors.userEmailExists(data.email);
    }
    throw error;
  }
}

export async function updateUser(
  orgId: string,
  userId: string,
  data: { name?: string; role?: "admin" | "support" },
) {
  const result = await forOrg(orgId, async (tx) => {
    return tx
      .update(users)
      .set(data)
      .where(eq(users.id, userId))
      .returning();
  });

  if (result.length === 0) {
    throw Errors.userNotFound(userId);
  }

  return result[0];
}

export async function deactivateUser(orgId: string, userId: string) {
  const result = await forOrg(orgId, async (tx) => {
    return tx
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, userId))
      .returning();
  });

  if (result.length === 0) {
    throw Errors.userNotFound(userId);
  }

  return result[0];
}
