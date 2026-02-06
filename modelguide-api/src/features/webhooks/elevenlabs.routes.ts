/**
 * ElevenLabs webhook handlers
 *
 * Two endpoints following the official ElevenLabs integration pattern:
 * - POST /tool          — tool call during a conversation
 * - POST /post-call     — post_call_transcription after call ends
 *
 * Both verify the ElevenLabs signature and authenticate the agent
 * via the mg_api_key dynamic variable.
 */

import { env } from "@/env";
import { db } from "@db/client";
import { agents, apiKeys, sessionMessages, sessions } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { hashApiKey, isValidApiKeyFormat } from "@lib/crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  type DynamicVariables,
  postCallTranscriptionPayloadSchema,
  toolCallPayloadSchema,
} from "./elevenlabs.schemas";

const elevenlabs = new ElevenLabsClient();

const app = new Hono();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Verify ElevenLabs webhook signature.
 * Must consume the raw body — Hono gives us text via c.req.text().
 */
async function verifySignature(rawBody: string, signature: string) {
  return elevenlabs.webhooks.constructEvent(
    rawBody,
    signature,
    env.ELEVENLABS_WEBHOOK_SECRET,
  );
}

/**
 * Resolve an mg_api_key to its agent + organization context.
 * Reuses the same lookup logic as the auth middleware.
 */
// TODO: Remove dev bypass — always resolve from DB in production
const DEV_BYPASS_AGENT =
  env.NODE_ENV === "development"
    ? {
        id: "00000000-0000-0000-0000-000000000000",
        name: "dev-agent",
        organizationId: "00000000-0000-0000-0000-000000000000",
        agentType: "voice" as const,
        isActive: true,
      }
    : null;

async function resolveAgent(vars: DynamicVariables) {
  const key = vars.mg_api_key;

  // Dev bypass: skip DB lookup when key is not a real mgk_ key
  if (DEV_BYPASS_AGENT && !isValidApiKeyFormat(key)) {
    console.warn("[webhook] Dev bypass: using fake agent context");
    return DEV_BYPASS_AGENT;
  }

  if (!isValidApiKeyFormat(key)) return null;

  const keyHash = hashApiKey(key);
  const rows = await db
    .select({ apiKey: apiKeys, agent: agents })
    .from(apiKeys)
    .leftJoin(agents, eq(apiKeys.agentId, agents.id))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (rows.length === 0) {
    if (DEV_BYPASS_AGENT) {
      console.warn(
        "[webhook] Dev bypass: API key not found in DB, using fake agent context",
      );
      return DEV_BYPASS_AGENT;
    }
    return null;
  }

  const { apiKey, agent } = rows[0];
  if (!apiKey.isActive || !agent?.isActive) return null;

  return agent;
}

// ============================================================================
// POST /tool — tool call during conversation
// ============================================================================

app.post("/tool", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("elevenlabs-signature") ?? "";

  // 1. Verify webhook signature
  try {
    await verifySignature(rawBody, signature);
  } catch {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // 2. Parse & validate payload
  const parsed = toolCallPayloadSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const { tool_name, parameters, dynamic_variables } = parsed.data;

  // 3. Authenticate agent
  const agent = await resolveAgent(dynamic_variables);
  if (!agent) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  // 4. Execute tool
  // TODO: Route tool_name (e.g. "pizzapalace_add_to_cart") to the
  // matching connector tool and call ModelGuide's connector API.
  //
  // const [connectorSlug, ...actionParts] = tool_name.split("_");
  // const action = actionParts.join("_");
  // const result = await connectorService.executeTool(agent.organizationId, connectorSlug, action, parameters);
  // return c.json(result);

  console.log(
    `[webhook/tool] agent=${agent.name} tool=${tool_name} params=${JSON.stringify(parameters)}`,
  );

  return c.json({
    success: true,
    tool_name,
    message: `Tool '${tool_name}' received — connector execution not yet wired`,
  });
});

// ============================================================================
// POST /post-call — post_call_transcription webhook
// ============================================================================

app.post("/post-call", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("elevenlabs-signature") ?? "";

  // 1. Verify webhook signature
  try {
    await verifySignature(rawBody, signature);
  } catch {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // 2. Parse & validate payload
  const parsed = postCallTranscriptionPayloadSchema.safeParse(
    JSON.parse(rawBody),
  );
  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const { data } = parsed.data;
  const dynamicVars =
    data.conversation_initiation_client_data?.dynamic_variables;

  // 3. Authenticate agent (optional — post-call may not carry dynamic_variables)
  if (!dynamicVars) {
    console.warn(
      `[webhook/post-call] No dynamic_variables for conversation=${data.conversation_id}`,
    );
    return c.json({ received: true });
  }

  const agent = await resolveAgent(dynamicVars);
  if (!agent) {
    console.warn(
      `[webhook/post-call] Could not resolve agent for conversation=${data.conversation_id}`,
    );
    return c.json({ received: true });
  }

  // 4. Create session + store transcript
  // TODO: Replace hardcoded values with real session service calls when available.
  //
  // const session = await sessionService.create({
  //   organizationId: agent.organizationId,
  //   agentId: agent.id,
  //   externalId: data.conversation_id,
  //   channelType: "voice",
  //   userIdentifier: dynamicVars.mg_user_id ?? null,
  //   status: "completed",
  //   startedAt: new Date(data.metadata.start_time_unix_secs * 1000),
  //   endedAt: new Date((data.metadata.start_time_unix_secs + data.metadata.call_duration_secs) * 1000),
  //   metadata: {
  //     call_duration_secs: data.metadata.call_duration_secs,
  //     transcript_summary: data.analysis.transcript_summary,
  //     call_successful: data.analysis.call_successful,
  //     elevenlabs_agent_id: data.agent_id,
  //   },
  // });

  const [session] = await db
    .insert(sessions)
    .values({
      organizationId: agent.organizationId,
      agentId: agent.id,
      externalId: data.conversation_id,
      channelType: "voice",
      userIdentifier: dynamicVars.mg_user_id ?? null,
      status: "completed",
      startedAt: new Date(data.metadata.start_time_unix_secs * 1000),
      endedAt: new Date(
        (data.metadata.start_time_unix_secs +
          data.metadata.call_duration_secs) *
          1000,
      ),
      metadata: {
        call_duration_secs: data.metadata.call_duration_secs,
        transcript_summary: data.analysis.transcript_summary,
        call_successful: data.analysis.call_successful,
        elevenlabs_agent_id: data.agent_id,
      },
    })
    .returning();

  // 5. Store transcript messages
  if (data.transcript.length > 0) {
    await db.insert(sessionMessages).values(
      data.transcript.map((msg, idx) => ({
        sessionId: session.id,
        role: msg.role === "agent" ? ("assistant" as const) : ("user" as const),
        content: msg.message,
        toolInput: msg.tool_calls as Record<string, unknown> | undefined,
        toolOutput: msg.tool_results as Record<string, unknown> | undefined,
        sequenceNumber: idx + 1,
      })),
    );
  }

  console.log(
    `[webhook/post-call] Stored session=${session.id} conversation=${data.conversation_id} messages=${data.transcript.length}`,
  );

  return c.json({ received: true, session_id: session.id });
});

export default app;
