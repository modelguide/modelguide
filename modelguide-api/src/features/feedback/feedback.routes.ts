/**
 * Feedback routes — mounted under /sessions/:id/feedback
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getCurrentUser,
  getOrganizationId,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { errorResponse } from "@lib/schemas";
import { feedbackResponseSchema, formatFeedback } from "./feedback.schemas";
import { addFeedback, listFeedback } from "./feedback.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const createFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(2).openapi({
    description: "Feedback rating: 1 = negative, 2 = positive",
    example: 2,
  }),
  comment: z.string().max(2000).optional().openapi({
    description: "Optional feedback comment",
  }),
  feedbackSource: z.enum(["support", "system"]).openapi({
    description: "Source of feedback (customer excluded from REST)",
    example: "support",
  }),
  feedbackTags: z
    .array(z.string().max(50))
    .max(10)
    .optional()
    .openapi({ description: "Optional tags" }),
});

const sessionIdParams = z.object({
  id: z.string().uuid().openapi({
    description: "Session ID",
  }),
});

// ============================================================================
// Routes
// ============================================================================

// GET /:id/feedback — List feedback (User auth)
router.get(
  "/:id/feedback",
  requireUser(),
  requirePermission("feedback:read"),
  requireOrganization(),
);

const listFeedbackRoute = createRoute({
  method: "get",
  path: "/{id}/feedback",
  tags: ["Feedback"],
  summary: "List session feedback",
  description: "Returns all feedback entries for a session.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sessionIdParams,
  },
  responses: {
    200: {
      description: "Feedback entries",
      content: {
        "application/json": {
          schema: z.object({ items: z.array(feedbackResponseSchema) }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Session not found"),
  },
});

router.openapi(listFeedbackRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const feedback = await listFeedback(orgId, id);

  return c.json({ items: feedback.map(formatFeedback) }, 200);
});

// POST /:id/feedback — Create feedback (User auth)
router.post(
  "/:id/feedback",
  requireUser(),
  requirePermission("feedback:create"),
  requireOrganization(),
);

const createFeedbackRoute = createRoute({
  method: "post",
  path: "/{id}/feedback",
  tags: ["Feedback"],
  summary: "Create session feedback",
  description:
    "Creates a feedback entry on a session. feedbackRef and userIdentifier are auto-populated from the authenticated user.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sessionIdParams,
    body: {
      content: {
        "application/json": { schema: createFeedbackSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Feedback created",
      content: {
        "application/json": { schema: feedbackResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Session not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createFeedbackRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const user = getCurrentUser(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const feedback = await addFeedback(orgId, id, {
    ...body,
    feedbackRef: user.id,
    userIdentifier: user.email,
  });

  return c.json(formatFeedback(feedback), 201);
});

export default router;
