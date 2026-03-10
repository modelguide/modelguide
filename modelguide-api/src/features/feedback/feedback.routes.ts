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
import {
  feedbackResponseSchema,
  formatFeedback,
  sessionIdParams,
} from "./feedback.schemas";
import { addFeedback, listFeedback, updateFeedback } from "./feedback.service";

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
    "Creates a feedback entry on a session. feedbackRef and customerExternalId are auto-populated from the authenticated user.",
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
    customerExternalId: user.email,
  });

  return c.json(formatFeedback(feedback), 201);
});

// PATCH /:id/feedback/:feedbackId — Update feedback (User auth)
router.patch(
  "/:id/feedback/:feedbackId",
  requireUser(),
  requirePermission("feedback:update"),
  requireOrganization(),
);

const feedbackIdParams = z.object({
  id: z.string().uuid().openapi({ description: "Session ID" }),
  feedbackId: z.string().uuid().openapi({ description: "Feedback ID" }),
});

const updateFeedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(2).optional().openapi({
      description: "Feedback rating: 1 = negative, 2 = positive",
    }),
    comment: z.string().max(2000).optional().openapi({
      description: "Optional feedback comment",
    }),
    feedbackTags: z
      .array(z.string().max(50))
      .max(10)
      .optional()
      .openapi({ description: "Optional tags" }),
  })
  .strict()
  .refine(
    (data) =>
      data.rating !== undefined ||
      data.comment !== undefined ||
      data.feedbackTags !== undefined,
    { message: "At least one field must be provided" },
  );

const updateFeedbackRoute = createRoute({
  method: "patch",
  path: "/{id}/feedback/{feedbackId}",
  tags: ["Feedback"],
  summary: "Update session feedback",
  description: "Updates an existing feedback entry on a session.",
  security: [{ bearerAuth: [] }],
  request: {
    params: feedbackIdParams,
    body: {
      content: {
        "application/json": { schema: updateFeedbackSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Feedback updated",
      content: {
        "application/json": { schema: feedbackResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Feedback not found"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateFeedbackRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const user = getCurrentUser(c);
  const { id, feedbackId } = c.req.valid("param");
  const body = c.req.valid("json");
  const feedback = await updateFeedback(orgId, id, feedbackId, user.id, body);

  return c.json(formatFeedback(feedback), 200);
});

export default router;
