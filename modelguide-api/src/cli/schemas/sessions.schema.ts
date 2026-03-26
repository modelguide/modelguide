import { z } from "zod";

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

const sessionStatuses = ["active", "completed", "abandoned"] as const;

const messageRoles = ["user", "assistant", "system", "tool"] as const;

const feedbackSources = ["customer", "support", "system"] as const;

const sessionMessageSchema = z.object({
  role: z.enum(messageRoles),
  content: z.string().min(1),
});

const sessionFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  source: z.enum(feedbackSources).default("customer"),
});

const sessionLinkSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  connectorSlug: z.string().optional(),
  resourceType: z.string().optional(),
});

export const sessionItemSchema = z.object({
  agentSlug: z.string().min(1),
  // Explicit idempotency key for repeatable imports. Optional because the CLI
  // can derive a deterministic fallback from the rest of the payload.
  externalId: z.string().max(255).optional(),
  channel: z.enum(channelTypes),
  status: z.enum(sessionStatuses).default("completed"),
  userIdentifier: z.string().min(1),
  hoursAgo: z.number().default(1),
  messages: z.array(sessionMessageSchema).min(1),
  feedback: sessionFeedbackSchema.optional(),
  links: z.array(sessionLinkSchema).default([]),
});

export const sessionsFileSchema = z.object({
  sessions: z.array(sessionItemSchema).min(1),
});

export type SessionItemInput = z.infer<typeof sessionItemSchema>;
