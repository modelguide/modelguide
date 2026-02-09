/**
 * Zod schemas for ElevenLabs webhook payloads
 * Based on: https://elevenlabs.io/docs/conversational-ai/webhooks
 */

import { z } from "zod";

// ============================================================================
// Shared
// ============================================================================

export const dynamicVariablesSchema = z
  .object({
    mg_api_key: z.string().startsWith("mgk_").optional(),
    mg_user_id: z.string().optional(),
    mg_session_id: z.string().uuid().optional(),
  })
  .passthrough();

export type DynamicVariables = z.infer<typeof dynamicVariablesSchema>;

// ============================================================================
// Tool Call Webhook
// ============================================================================

export const toolCallPayloadSchema = z.object({
  conversation_id: z.string(),
  agent_id: z.string(),
  tool_name: z.string(),
  parameters: z.record(z.unknown()),
  dynamic_variables: dynamicVariablesSchema,
});

export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>;

// ============================================================================
// Post-Call Transcription Webhook
// ============================================================================

const transcriptEntrySchema = z.object({
  role: z.enum(["agent", "user"]),
  message: z.string().nullable().default(""),
  tool_calls: z.unknown().nullable(),
  tool_results: z.unknown().nullable(),
  feedback: z.unknown().nullable(),
  time_in_call_secs: z.number(),
  conversation_turn_metrics: z.unknown().nullable(),
});

const callMetadataSchema = z.object({
  start_time_unix_secs: z.number(),
  call_duration_secs: z.number(),
  cost: z.number().optional(),
  deletion_settings: z.record(z.unknown()).optional(),
  feedback: z
    .object({
      overall_score: z.unknown().nullable(),
      likes: z.number(),
      dislikes: z.number(),
    })
    .optional(),
  authorization_method: z.string().optional(),
  charging: z.record(z.unknown()).optional(),
  termination_reason: z.string().optional(),
});

const callAnalysisSchema = z.object({
  evaluation_criteria_results: z.record(z.unknown()).optional(),
  data_collection_results: z.record(z.unknown()).optional(),
  call_successful: z.string().nullable().default("unknown"),
  transcript_summary: z.string().nullable().default(""),
  call_summary_title: z.string().nullable().optional(),
});

const conversationInitiationClientDataSchema = z.object({
  conversation_config_override: z.record(z.unknown()).optional(),
  custom_llm_extra_body: z.record(z.unknown()).optional(),
  dynamic_variables: dynamicVariablesSchema.optional(),
});

export const postCallTranscriptionPayloadSchema = z.object({
  type: z.literal("post_call_transcription"),
  event_timestamp: z.number(),
  data: z.object({
    agent_id: z.string(),
    conversation_id: z.string(),
    status: z.string(),
    transcript: z.array(transcriptEntrySchema),
    metadata: callMetadataSchema,
    analysis: callAnalysisSchema,
    conversation_initiation_client_data:
      conversationInitiationClientDataSchema.optional(),
  }),
});

export type PostCallTranscriptionPayload = z.infer<
  typeof postCallTranscriptionPayloadSchema
>;
