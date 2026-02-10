/**
 * ElevenLabs webhook handlers
 *
 * POST /:agentId/post-call — post_call_transcription after call ends
 *
 * Tool calls during conversation go through the MCP endpoint (/mcp).
 * Auth is via HMAC signature verification using the agent's webhook_hmac_secret.
 */

import { env } from "@/env";
import { db } from "@db/client";
import { agents, sessionMessages, sessions } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { getAgentSecretByType } from "@features/secrets";
import { convertPostCallToSession } from "./elevenlabs.converter";
import { postCallTranscriptionPayloadSchema } from "./elevenlabs.schemas";

const app = new Hono();

// ============================================================================
// Helpers
// ============================================================================

async function verifySignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
) {
  const client = new ElevenLabsClient({ apiKey: "unused" });
  return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

async function getAgentWithMetadata(agentId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return agent ?? null;
}

// ============================================================================
// POST /:agentId/post-call — post_call_transcription webhook
// ============================================================================

app.post("/:agentId/post-call", async (c) => {
  const agentId = c.req.param("agentId");
  const rawBody = await c.req.text();
  const signature = c.req.header("elevenlabs-signature") ?? "";

  // 1. Look up agent and get webhook secret from metadata
  const agentRow = await getAgentWithMetadata(agentId);
  if (!agentRow || !agentRow.isActive) {
    return c.json({ error: "Agent not found or inactive" }, 404);
  }

  const webhookSecret = await getAgentSecretByType(
    agentRow.organizationId,
    agentId,
    "webhook_secret",
  );

  if (!webhookSecret) {
    console.error(
      `[webhook/post-call] No webhook_secret in secrets table for agent=${agentId}`,
    );
    return c.json(
      { error: "Webhook secret not configured for this agent" },
      500,
    );
  }

  // 2. Verify webhook signature with agent-specific secret
  const skipHmac =
    env.NODE_ENV === "development" && c.req.header("x-skip-hmac") === "true";

  if (!skipHmac) {
    try {
      await verifySignature(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error("[webhook/post-call] Signature verification failed:", err);
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // 3. Parse & validate payload
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    console.error("[webhook/post-call] Invalid JSON body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = postCallTranscriptionPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error(
      "[webhook/post-call] Validation failed:",
      JSON.stringify(parsed.error.flatten()),
    );
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const { data } = parsed.data;
  const dynamicVars =
    data.conversation_initiation_client_data?.dynamic_variables;

  const agent = {
    id: agentRow.id,
    organizationId: agentRow.organizationId,
  };

  // 4. Convert payload to ModelGuide shapes
  const conversationId =
    data.conversation_id ?? dynamicVars?.system__conversation_id;

  if (!conversationId) {
    console.error(
      "[webhook/post-call] No conversation_id in payload or dynamic_variables",
    );
    return c.json({ error: "Missing conversation_id" }, 400);
  }

  const converted = convertPostCallToSession(data, dynamicVars, conversationId);
  const existingSessionId = dynamicVars?.mg_session_id;

  // 5. Idempotency: check if session with this externalId already exists
  const [existingByExternalId] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.agentId, agent.id),
        eq(sessions.externalId, conversationId),
      ),
    )
    .limit(1);

  if (existingByExternalId) {
    console.log(
      `[webhook/post-call] Duplicate: conversation=${conversationId} already stored as session=${existingByExternalId.id}`,
    );
    return c.json({ received: true, session_id: existingByExternalId.id });
  }

  // 6. Store session + messages in a transaction
  let sessionId: string;

  try {
    sessionId = await db.transaction(async (tx) => {
      if (existingSessionId) {
        // Session was created upfront — insert transcript messages, then complete
        if (converted.messages.length > 0) {
          await tx.insert(sessionMessages).values(
            converted.messages.map((msg) => ({
              sessionId: existingSessionId,
              ...msg,
            })),
          );
        }

        const [updated] = await tx
          .update(sessions)
          .set({
            status: "completed",
            externalId: converted.session.externalId,
            endedAt: converted.session.endedAt,
            metadata: converted.session.metadata,
          })
          .where(
            and(
              eq(sessions.id, existingSessionId),
              eq(sessions.agentId, agent.id),
            ),
          )
          .returning({ id: sessions.id });

        return updated?.id ?? existingSessionId;
      }

      // Fallback: create session retroactively
      const [session] = await tx
        .insert(sessions)
        .values({
          organizationId: agent.organizationId,
          agentId: agent.id,
          ...converted.session,
        })
        .returning({ id: sessions.id });

      if (converted.messages.length > 0) {
        await tx.insert(sessionMessages).values(
          converted.messages.map((msg) => ({
            sessionId: session.id,
            ...msg,
          })),
        );
      }

      return session.id;
    });
  } catch (err) {
    console.error(
      `[webhook/post-call] DB error: conversation=${conversationId} agent=${agentId}`,
      err,
    );
    return c.json({ error: "Failed to store session" }, 500);
  }

  console.log(
    `[webhook/post-call] ${existingSessionId ? "Updated" : "Created"} session=${sessionId} agent=${agentId} conversation=${conversationId} messages=${converted.messages.length}`,
  );

  return c.json({ received: true, session_id: sessionId });
});

export default app;
