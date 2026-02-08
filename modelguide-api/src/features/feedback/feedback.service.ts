/**
 * Feedback service - business logic for session feedback management
 */

import { forOrg } from "@db/rls";
import { sessionFeedback, sessions } from "@db/schema";
import { Errors } from "@lib/errors";
import { asc, eq } from "drizzle-orm";

export async function listFeedback(orgId: string, sessionId: string) {
  return forOrg(orgId, async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) throw Errors.sessionNotFound(sessionId);

    return tx
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId))
      .orderBy(asc(sessionFeedback.createdAt));
  });
}

export async function addFeedback(
  orgId: string,
  sessionId: string,
  data: {
    rating: number;
    comment?: string;
    feedbackSource: "customer" | "support" | "system";
    feedbackRef?: string;
    feedbackTags?: string[];
    userIdentifier?: string;
  },
) {
  return forOrg(orgId, async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session) throw Errors.sessionNotFound(sessionId);

    const [feedback] = await tx
      .insert(sessionFeedback)
      .values({
        sessionId,
        rating: data.rating,
        comment: data.comment ?? null,
        feedbackSource: data.feedbackSource,
        feedbackRef: data.feedbackRef ?? null,
        feedbackTags: data.feedbackTags ?? [],
        userIdentifier: data.userIdentifier ?? null,
      })
      .returning();

    return feedback;
  });
}
