/**
 * PostgreSQL enum definitions for the database schema
 */

import { pgEnum } from "drizzle-orm/pg-core";

/**
 * User roles for platform users (admin, support)
 */
export const userRoleEnum = pgEnum("user_role", ["admin", "support", "viewer"]);

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
  "webhook_secret",
]);

/**
 * Secret scope — browsing label for org vault. Not an ownership constraint.
 * NULL = unscoped (appears in all selectors).
 */
export const secretScopeEnum = pgEnum("secret_scope", ["connector", "agent"]);

/**
 * Agent modalities
 */
export const modalityEnum = pgEnum("modality", ["voice", "text"]);

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
 * Tool call execution status
 */
export const toolStatusEnum = pgEnum("tool_status", ["success", "error"]);

/**
 * Feedback sources
 */
export const feedbackSourceEnum = pgEnum("feedback_source", [
  "customer",
  "support",
  "system",
]);

/**
 * SOP lifecycle status
 */
export const sopStatusEnum = pgEnum("sop_status", [
  "draft",
  "active",
  "archived",
]);

// ============================================================================
// Evaluation engine enums
// ============================================================================

/**
 * Evaluator types — determines which evaluator function runs
 */
export const evaluatorTypeEnum = pgEnum("evaluator_type", [
  "tool_called",
  "tool_input_contains",
  "no_tool_called",
  "llm_judge",
]);

/**
 * Eval source types — what produced the eval (SOP, guardrail, etc.)
 */
export const evalSourceTypeEnum = pgEnum("eval_source_type", ["sop"]);

/**
 * Eval run status
 */
export const evalStatusEnum = pgEnum("eval_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

/**
 * Eval score result
 */
export const evalScoreResultEnum = pgEnum("eval_score_result", [
  "pass",
  "fail",
  "skip",
  "error",
]);
