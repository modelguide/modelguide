/**
 * Shared feedback schemas and formatters — used by both feedback and session routes
 */

import type { SessionFeedback } from "@db/schema";
import { z } from "zod";

export const sessionIdParams = z.object({
  id: z.string().uuid().openapi({
    description: "Session ID",
  }),
});

export const feedbackResponseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  rating: z.number(),
  comment: z.string().nullable(),
  feedbackSource: z.enum(["customer", "support", "system"]),
  feedbackRef: z.string().nullable(),
  feedbackTags: z.array(z.string()).nullable(),
  userIdentifier: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});

export function formatFeedback(feedback: SessionFeedback) {
  return {
    id: feedback.id,
    sessionId: feedback.sessionId,
    messageId: feedback.messageId,
    rating: feedback.rating,
    comment: feedback.comment,
    feedbackSource: feedback.feedbackSource,
    feedbackRef: feedback.feedbackRef,
    feedbackTags: feedback.feedbackTags,
    userIdentifier: feedback.userIdentifier,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt?.toISOString() ?? null,
  };
}
