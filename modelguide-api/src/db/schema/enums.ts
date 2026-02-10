/**
 * PostgreSQL enum definitions for the database schema
 */

import { pgEnum } from "drizzle-orm/pg-core";

/**
 * User roles for platform users (admin, support)
 */
export const userRoleEnum = pgEnum("user_role", ["admin", "support"]);

/**
 * Connector types indicating how the connector communicates
 */
export const connectorTypeEnum = pgEnum("connector_type", [
  "api",
  "webhook",
  "database",
  "messaging",
]);

/**
 * Secret types for encrypted credential storage
 */
export const secretTypeEnum = pgEnum("secret_type", [
  "api_key",
  "oauth_token",
  "credentials",
  "platform_api_key",
]);

/**
 * Owner types for polymorphic secret ownership
 */
export const ownerTypeEnum = pgEnum("owner_type", ["connector", "agent"]);

/**
 * Agent types (voice only for V1)
 */
export const agentTypeEnum = pgEnum("agent_type", ["voice"]);

/**
 * Agent platform — where the agent runs
 */
export const agentPlatformEnum = pgEnum("agent_platform", [
  "custom",
  "elevenlabs",
]);

/**
 * Session status indicating conversation state
 */
export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "completed",
  "escalated",
  "abandoned",
]);

/**
 * Channel types for session origination
 */
export const channelTypeEnum = pgEnum("channel_type", [
  "voice",
  "web",
  "api",
  "slack",
  "widget",
  "sms",
  "whatsapp",
  "email",
]);

/**
 * Message roles in a session
 */
export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

/**
 * Feedback sources
 */
export const feedbackSourceEnum = pgEnum("feedback_source", [
  "customer",
  "support",
  "system",
]);
