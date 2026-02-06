import { forOrg } from "@db/rls";
import { organizations } from "@db/schema";
import { Errors } from "@lib/errors";
import { eq } from "drizzle-orm";

export async function getOrganizationById(organizationId: string) {
  const result = await forOrg(organizationId, async (tx) => {
    return tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));
  });

  if (result.length === 0) {
    throw Errors.organizationNotFound(organizationId);
  }

  return result[0];
}
