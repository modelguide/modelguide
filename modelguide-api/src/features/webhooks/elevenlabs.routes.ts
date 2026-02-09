/**
 * ElevenLabs webhook handlers
 *
 * POST /:agentId/post-call — post_call_transcription after call ends
 *
 * Tool calls during conversation go through the MCP endpoint (/mcp).
 * Auth is via HMAC signature verification using the agent's hmac_secret.
 */

import { env } from "@/env";
import { db } from "@db/client";
import { agents, sessionMessages, sessions } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { postCallTranscriptionPayloadSchema } from "./elevenlabs.schemas";
import { convertPostCallToSession } from "./elevenlabs.converter";

const elevenlabs = new ElevenLabsClient();

const app = new Hono();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Verify ElevenLabs webhook signature using the agent's webhook secret.
 * Must consume the raw body — Hono gives us text via c.req.text().
 */
async function verifySignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
) {
  return elevenlabs.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Look up an agent by ID and return it with its metadata.
 */
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

  const webhookSecret =
    (agentRow.metadata as Record<string, unknown>)
      ?.hmac_secret as string | undefined;

  if (!webhookSecret) {
    console.error(
      `[webhook/post-call] No hmac_secret in metadata for agent=${agentId}`,
    );
    return c.json({ error: "Webhook secret not configured for this agent" }, 500);
  }

  // 2. Verify webhook signature with agent-specific secret
  const skipHmac =
    env.NODE_ENV === "development" &&
    c.req.header("x-skip-hmac") === "true";

  if (!skipHmac) {
    try {
      await verifySignature(rawBody, signature, webhookSecret);
    } catch (err) {
      console.error("[webhook/post-call] Signature verification failed:", err);
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // 3. Parse & validate payload
  const rawJson = JSON.parse(rawBody);
  if (env.NODE_ENV === "development") {
    const fs = await import("node:fs");
    fs.writeFileSync("/tmp/elevenlabs-post-call.json", rawBody);
    console.log("[webhook/post-call] Saved raw payload to /tmp/elevenlabs-post-call.json");
  }
  console.log("[webhook/post-call] Transcript entries:", rawJson.data?.transcript?.length ?? 0);

  const parsed = postCallTranscriptionPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error("[webhook/post-call] Validation failed:", JSON.stringify(parsed.error.flatten()));
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

  // 5. Convert payload to ModelGuide shapes
  const converted = convertPostCallToSession(data, dynamicVars);
  const existingSessionId = dynamicVars?.mg_session_id;

  let sessionId: string;

  if (existingSessionId) {
    // Session was created upfront — insert transcript messages first, then complete
    if (converted.messages.length > 0) {
      await db.insert(sessionMessages).values(
        converted.messages.map((msg) => ({
          sessionId: existingSessionId,
          ...msg,
        })),
      );
    }

    const [updated] = await db
      .update(sessions)
      .set({
        status: "completed",
        externalId: converted.session.externalId,
        endedAt: converted.session.endedAt,
        metadata: converted.session.metadata,
      })
      .where(eq(sessions.id, existingSessionId))
      .returning();

    sessionId = updated?.id ?? existingSessionId;
  } else {
    // Fallback: create session retroactively
    const [session] = await db
      .insert(sessions)
      .values({
        organizationId: agent.organizationId,
        agentId: agent.id,
        ...converted.session,
      })
      .returning();

    if (converted.messages.length > 0) {
      await db.insert(sessionMessages).values(
        converted.messages.map((msg) => ({
          sessionId: session.id,
          ...msg,
        })),
      );
    }

    sessionId = session.id;
  }

  console.log(
    `[webhook/post-call] ${existingSessionId ? "Updated" : "Created"} session=${sessionId} agent=${agentId} conversation=${data.conversation_id} messages=${converted.messages.length}`,
  );

  return c.json({ received: true, session_id: sessionId });
});

export default app;
