import { forOrg } from "@db/rls";
import { confirmations } from "@db/schema";
import { and, eq, gt, sql } from "drizzle-orm";

export const CONFIRMATION_TTL_SECONDS = 300; // 5 minutes

interface CreateConfirmationParams {
  agentId: string;
  connectorId: string;
  mcpToolName: string;
  args: Record<string, unknown> | null;
}

export async function createConfirmation(
  orgId: string,
  params: CreateConfirmationParams,
) {
  return forOrg(orgId, async (tx) => {
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_SECONDS * 1000);

    const [confirmation] = await tx
      .insert(confirmations)
      .values({
        organizationId: orgId,
        agentId: params.agentId,
        connectorId: params.connectorId,
        mcpToolName: params.mcpToolName,
        args: params.args,
        status: "pending",
        expiresAt,
      })
      .returning();

    return confirmation;
  });
}

export async function consumeConfirmation(
  orgId: string,
  confirmationId: string,
  expectedToolName: string,
  expectedAgentId: string,
) {
  return forOrg(orgId, async (tx) => {
    // Atomic UPDATE with all conditions in WHERE — prevents TOCTOU race
    const [updated] = await tx
      .update(confirmations)
      .set({
        status: "consumed",
        consumedAt: new Date(),
      })
      .where(
        and(
          eq(confirmations.id, confirmationId),
          eq(confirmations.status, "pending"),
          eq(confirmations.mcpToolName, expectedToolName),
          eq(confirmations.agentId, expectedAgentId),
          gt(confirmations.expiresAt, sql`now()`),
        ),
      )
      .returning();

    return updated ?? null;
  });
}
