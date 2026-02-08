/**
 * Analytics routes
 */

import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@lib/create-app";
import {
  getOrganizationId,
  requireOrganization,
  requirePermission,
  requireUser,
} from "@lib/middleware";
import { errorResponse } from "@lib/schemas";
import { getSummary, getTrends } from "./analytics.service";

const router = createRouter();

// ============================================================================
// Schemas
// ============================================================================

const channelTypes = [
  "voice",
  "web",
  "api",
  "slack",
  "widget",
  "sms",
  "whatsapp",
  "email",
] as const;

const summaryQuerySchema = z.object({
  from_date: z.string().date().openapi({ description: "Start date (ISO)" }),
  to_date: z.string().date().openapi({ description: "End date (ISO)" }),
  agent_id: z
    .string()
    .uuid()
    .optional()
    .openapi({ description: "Filter by agent" }),
  channel_type: z
    .enum(channelTypes)
    .optional()
    .openapi({ description: "Filter by channel type" }),
});

const sessionsByStatusSchema = z.object({
  active: z.number(),
  completed: z.number(),
  escalated: z.number(),
  abandoned: z.number(),
});

const sessionsByChannelSchema = z.object({
  voice: z.number(),
  web: z.number(),
  api: z.number(),
  slack: z.number(),
  widget: z.number(),
  sms: z.number(),
  whatsapp: z.number(),
  email: z.number(),
});

const feedbackCountSchema = z.object({
  customer: z.number(),
  support: z.number(),
});

const summaryResponseSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  total_sessions: z.number(),
  sessions_by_status: sessionsByStatusSchema,
  sessions_by_channel: sessionsByChannelSchema,
  resolution_rate: z.number(),
  escalation_rate: z.number(),
  abandonment_rate: z.number(),
  avg_duration_seconds: z.number().nullable(),
  csat_score: z.number().nullable(),
  support_evaluation_score: z.number().nullable(),
  feedback_count: feedbackCountSchema,
});

const trendMetrics = [
  "sessions",
  "csat",
  "resolution_rate",
  "escalation_rate",
  "duration",
] as const;

const granularities = ["hour", "day", "week", "month"] as const;

const trendsQuerySchema = z.object({
  metric: z.enum(trendMetrics).openapi({ description: "Metric to trend" }),
  granularity: z
    .enum(granularities)
    .openapi({ description: "Time bucket granularity" }),
  from_date: z.string().date().openapi({ description: "Start date (ISO)" }),
  to_date: z.string().date().openapi({ description: "End date (ISO)" }),
  agent_id: z
    .string()
    .uuid()
    .optional()
    .openapi({ description: "Filter by agent" }),
  channel_type: z
    .enum(channelTypes)
    .optional()
    .openapi({ description: "Filter by channel type" }),
});

const trendPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

const trendsResponseSchema = z.object({
  metric: z.string(),
  granularity: z.string(),
  data: z.array(trendPointSchema),
});

// ============================================================================
// Middleware
// ============================================================================

router.get(
  "/",
  requireUser(),
  requirePermission("analytics:read"),
  requireOrganization(),
);
router.get(
  "/trends",
  requireUser(),
  requirePermission("analytics:read"),
  requireOrganization(),
);

// ============================================================================
// Routes
// ============================================================================

const getSummaryRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Analytics"],
  summary: "Get analytics summary",
  description:
    "Returns aggregated analytics metrics for sessions and feedback within the specified date range.",
  security: [{ bearerAuth: [] }],
  request: {
    query: summaryQuerySchema,
  },
  responses: {
    200: {
      description: "Analytics summary",
      content: {
        "application/json": { schema: summaryResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(getSummaryRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { from_date, to_date, agent_id, channel_type } =
    c.req.valid("query");

  const result = await getSummary(orgId, {
    fromDate: from_date,
    toDate: to_date,
    agentId: agent_id,
    channelType: channel_type,
  });

  return c.json(result, 200);
});

const getTrendsRoute = createRoute({
  method: "get",
  path: "/trends",
  tags: ["Analytics"],
  summary: "Get analytics trends",
  description:
    "Returns time-series trend data for the specified metric and granularity.",
  security: [{ bearerAuth: [] }],
  request: {
    query: trendsQuerySchema,
  },
  responses: {
    200: {
      description: "Trend data",
      content: {
        "application/json": { schema: trendsResponseSchema },
      },
    },
    401: errorResponse("Not authenticated"),
    403: errorResponse("Insufficient permissions"),
    422: errorResponse("Validation error"),
  },
});

router.openapi(getTrendsRoute, async (c) => {
  const orgId = getOrganizationId(c);
  const { metric, granularity, from_date, to_date, agent_id, channel_type } =
    c.req.valid("query");

  const result = await getTrends(orgId, metric, granularity, {
    fromDate: from_date,
    toDate: to_date,
    agentId: agent_id,
    channelType: channel_type,
  });

  return c.json(result, 200);
});

export default router;
