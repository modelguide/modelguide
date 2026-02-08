/**
 * Session management routes
 */

import type { Session, SessionFeedback, SessionMessage } from "@db/schema";
import {
  feedbackResponseSchema,
  formatFeedback,
} from "@features/feedback/feedback.schemas";
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getCurrentAgent,
  getOrganizationId,
  requireAgent,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { paginatedResponseSchema, paginationSchema } from "@lib/pagination";
import { errorResponse } from "@lib/schemas";
import {
  addMessage,
  createSession,
  getSessionById,
  listSessions,
  updateSession,
} from "./sessions.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const agentSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const feedbackSummarySchema = z.object({
  hasFeedback: z.boolean(),
});

const sessionResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  externalId: z.string().nullable(),
  channelType: z.string(),
  userIdentifier: z.string().nullable(),
  userMetadata: z.record(z.unknown()),
  status: z.enum(["active", "completed", "escalated", "abandoned"]),
  escalationRef: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  metadata: z.record(z.unknown()),
  agent: agentSummarySchema,
  messageCount: z.number(),
  durationSeconds: z.number().nullable(),
  feedbackSummary: feedbackSummarySchema,
});

const messageResponseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().nullable(),
  audioUrl: z.string().nullable(),
  audioDurationMs: z.number().nullable(),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  toolInput: z.record(z.unknown()).nullable(),
  toolOutput: z.record(z.unknown()).nullable(),
  modelUsed: z.string().nullable(),
  tokensUsed: z.number().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string(),
  occurredAt: z.string().nullable(),
});

const sessionDetailSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  externalId: z.string().nullable(),
  channelType: z.string(),
  userIdentifier: z.string().nullable(),
  userMetadata: z.record(z.unknown()),
  status: z.enum(["active", "completed", "escalated", "abandoned"]),
  escalationRef: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  metadata: z.record(z.unknown()),
  agent: agentSummarySchema,
  durationSeconds: z.number().nullable(),
  messages: z.array(messageResponseSchema),
  feedback: z.array(feedbackResponseSchema),
});

const createSessionSchema = z.object({
  externalId: z.string().max(255).optional().openapi({
    description: "External reference ID",
  }),
  channelType: z
    .enum([
      "voice",
      "web",
      "api",
      "slack",
      "widget",
      "sms",
      "whatsapp",
      "email",
    ])
    .openapi({ example: "voice" }),
  userIdentifier: z.string().max(255).openapi({
    description: "Customer identifier",
    example: "+1234567890",
  }),
  userMetadata: z.record(z.unknown()).optional().openapi({
    description: "Additional customer metadata",
  }),
});

const updateSessionSchema = z
  .object({
    status: z
      .enum(["completed", "escalated", "abandoned"])
      .optional()
      .openapi({ description: "New session status (terminal)" }),
    escalationRef: z
      .string()
      .max(255)
      .optional()
      .openapi({ description: "Escalation reference" }),
  })
  .refine(
    (data) => data.status !== undefined || data.escalationRef !== undefined,
    {
      message: "At least one of 'status' or 'escalationRef' must be provided",
    },
  );

const createMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).openapi({ example: "user" }),
  content: z.string().optional().openapi({
    description: "Message text content",
    example: "I'd like to order a large pepperoni pizza",
  }),
  audioUrl: z.string().url().optional().openapi({
    description: "URL to audio recording",
  }),
  toolCalls: z
    .array(
      z.object({
        toolCallId: z.string(),
        toolName: z.string(),
        toolInput: z.record(z.unknown()).optional(),
        toolOutput: z.record(z.unknown()).optional(),
      }),
    )
    .optional()
    .openapi({ description: "Tool calls for assistant messages" }),
});

const sessionFiltersSchema = paginationSchema.extend({
  agentId: z.string().uuid().optional().openapi({
    description: "Filter by agent ID",
  }),
  status: z
    .enum(["active", "completed", "escalated", "abandoned"])
    .optional()
    .openapi({ description: "Filter by status" }),
  channelType: z
    .enum([
      "voice",
      "web",
      "api",
      "slack",
      "widget",
      "sms",
      "whatsapp",
      "email",
    ])
    .optional()
    .openapi({ description: "Filter by channel type" }),
  hasFeedback: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
    .openapi({ description: "Filter by feedback presence" }),
  startedAfter: z.string().datetime().optional().openapi({
    description: "Sessions started after this ISO timestamp",
  }),
  startedBefore: z.string().datetime().optional().openapi({
    description: "Sessions started before this ISO timestamp",
  }),
  sortBy: z
    .enum(["started_at", "ended_at", "status"])
    .optional()
    .openapi({ description: "Sort field" }),
  sortOrder: z
    .enum(["asc", "desc"])
    .optional()
    .openapi({ description: "Sort direction" }),
});

const sessionIdParams = z.object({
  id: z.string().uuid().openapi({
    description: "Session ID",
  }),
});

// ============================================================================
// Helpers
// ============================================================================

function formatSession(
  session: Session & {
    agent: { id: string; name: string };
    messageCount: number;
    durationSeconds: number | null;
    feedbackSummary: { hasFeedback: boolean };
  },
) {
  return {
    id: session.id,
    organizationId: session.organizationId,
    agentId: session.agentId,
    externalId: session.externalId,
    channelType: session.channelType,
    userIdentifier: session.userIdentifier,
    userMetadata: session.userMetadata ?? {},
    status: session.status,
    escalationRef: session.escalationRef,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    metadata: session.metadata ?? {},
    agent: session.agent,
    messageCount: session.messageCount,
    durationSeconds: session.durationSeconds,
    feedbackSummary: session.feedbackSummary,
  };
}

function formatSessionDetail(
  session: Session & {
    agent: { id: string; name: string };
    durationSeconds: number | null;
    messages: SessionMessage[];
    feedback: SessionFeedback[];
  },
) {
  return {
    id: session.id,
    organizationId: session.organizationId,
    agentId: session.agentId,
    externalId: session.externalId,
    channelType: session.channelType,
    userIdentifier: session.userIdentifier,
    userMetadata: session.userMetadata ?? {},
    status: session.status,
    escalationRef: session.escalationRef,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    metadata: session.metadata ?? {},
    agent: session.agent,
    durationSeconds: session.durationSeconds,
    messages: session.messages.map(formatMessage),
    feedback: session.feedback.map(formatFeedback),
  };
}

function formatMessage(message: SessionMessage) {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    audioUrl: message.audioUrl,
    audioDurationMs: message.audioDurationMs,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    toolInput: message.toolInput ?? null,
    toolOutput: message.toolOutput ?? null,
    modelUsed: message.modelUsed,
    tokensUsed: message.tokensUsed,
    latencyMs: message.latencyMs,
    createdAt: message.createdAt.toISOString(),
    occurredAt: message.occurredAt?.toISOString() ?? null,
  };
}

function formatCreatedSession(session: Session) {
  return {
    id: session.id,
    organizationId: session.organizationId,
    agentId: session.agentId,
    externalId: session.externalId,
    channelType: session.channelType,
    userIdentifier: session.userIdentifier,
    userMetadata: session.userMetadata ?? {},
    status: session.status,
    escalationRef: session.escalationRef,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    metadata: session.metadata ?? {},
  };
}

// ============================================================================
// Routes
// ============================================================================

// GET / — List sessions (User auth)
router.get(
  "/",
  requireUser(),
  requirePermission("sessions:read"),
  requireOrganization(),
);

const listSessionsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sessions"],
  summary: "List sessions",
  description:
    "Returns paginated list of sessions with filters. Includes agent info, message count, and feedback summary.",
  security: [{ bearerAuth: [] }],
  request: {
    query: sessionFiltersSchema,
  },
  responses: {
    200: {
      description: "Paginated list of sessions",
      content: {
        "application/json": {
          schema: paginatedResponseSchema(sessionResponseSchema),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
  },
});

router.openapi(listSessionsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const query = c.req.valid("query");
  const result = await listSessions(orgId, query);

  return c.json(
    {
      data: result.data.map(formatSession),
      pagination: result.pagination,
    },
    200,
  );
});

// GET /:id — Session detail (User auth)
router.get(
  "/:id",
  requireUser(),
  requirePermission("sessions:read"),
  requireOrganization(),
);

const getSessionRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Sessions"],
  summary: "Get session detail",
  description: "Returns a single session with messages and feedback.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sessionIdParams,
  },
  responses: {
    200: {
      description: "Session detail with messages and feedback",
      content: {
        "application/json": { schema: sessionDetailSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    404: errorResponse("Session not found"),
  },
});

router.openapi(getSessionRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { id } = c.req.valid("param");
  const session = await getSessionById(orgId, id);

  return c.json(formatSessionDetail(session), 200);
});

// POST / — Create session (Agent auth)
router.post("/", requireAgent(), requireOrganization());

const createSessionRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Sessions"],
  summary: "Create session",
  description:
    "Creates a new session for the authenticated agent. Sets status to active.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createSessionSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Session created",
      content: {
        "application/json": {
          schema: sessionResponseSchema.omit({
            agent: true,
            messageCount: true,
            durationSeconds: true,
            feedbackSummary: true,
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(createSessionRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const agent = getCurrentAgent(c);
  const body = c.req.valid("json");
  const session = await createSession(orgId, agent.id, body);

  return c.json(formatCreatedSession(session), 201);
});

// PATCH /:id — Update session (Agent auth)
router.patch("/:id", requireAgent(), requireOrganization());

const updateSessionRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Sessions"],
  summary: "Update session",
  description:
    "Updates session status or escalation ref. Only allows transitions from active to terminal states.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sessionIdParams,
    body: {
      content: {
        "application/json": { schema: updateSessionSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Session updated",
      content: {
        "application/json": {
          schema: sessionResponseSchema.omit({
            agent: true,
            messageCount: true,
            durationSeconds: true,
            feedbackSummary: true,
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Session not found"),
    409: errorResponse("Session already ended"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(updateSessionRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const agent = getCurrentAgent(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const session = await updateSession(orgId, id, agent.id, body);

  return c.json(formatCreatedSession(session), 200);
});

// POST /:id/messages — Add message (Agent auth)
router.post("/:id/messages", requireAgent(), requireOrganization());

const addMessageRoute = createRoute({
  method: "post",
  path: "/{id}/messages",
  tags: ["Sessions"],
  summary: "Add message",
  description:
    "Adds a message to an active session. If role is assistant with toolCalls, creates tool messages.",
  security: [{ bearerAuth: [] }],
  request: {
    params: sessionIdParams,
    body: {
      content: {
        "application/json": { schema: createMessageSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Message(s) created",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(messageResponseSchema),
          }),
        },
      },
    },
    401: errorResponse("Not authenticated"),
    404: errorResponse("Session not found"),
    409: errorResponse("Session already ended"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(addMessageRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const agent = getCurrentAgent(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const messages = await addMessage(orgId, id, agent.id, body);

  return c.json({ data: messages.map(formatMessage) }, 201);
});

export default router;
