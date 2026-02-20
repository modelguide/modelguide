/**
 * ElevenLabs webhook handlers
 *
 * POST /:agentId/conversation-init — conversation initiation at call start (API key auth)
 * POST /:agentId/post-call          — post_call_transcription after call ends (HMAC auth)
 *
 * Tool calls during conversation go through the MCP endpoint (/mcp).
 */

import { env } from "@/env";
import { forApp, forOrg } from "@db/rls";
import { agents, sessionLinks, sessionMessages, sessions } from "@db/schema";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { getAgentSecretByType } from "@features/secrets";
import { extractLinks } from "@features/sessions/link-extraction";
import { verifyApiKey } from "@lib/middleware/auth";
import { convertPostCallToSession } from "./elevenlabs.converter";
import {
  conversationInitRequestSchema,
  postCallTranscriptionPayloadSchema,
} from "./elevenlabs.schemas";

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
  return forApp(async (tx) => {
    const [agent] = await tx
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return agent ?? null;
  });
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
  // Dev-only: allow skipping HMAC for manual replay scripts (replay-post-call.ts).
  // Safe in production because NODE_ENV !== "development".
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

  // 5. Extract external resource links from tool outputs
  const toolMessages = converted.messages
    .filter((m) => m.role === "tool" && m.toolOutput)
    .map((m) => ({
      toolName: m.toolName ?? "",
      toolOutput: m.toolOutput,
    }));
  const linkRows = extractLinks(toolMessages);

  // 6. Idempotency: check if session with this externalId already exists
  const [existingByExternalId] = await forOrg(agentRow.organizationId, (tx) =>
    tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.agentId, agent.id),
          eq(sessions.externalId, conversationId),
        ),
      )
      .limit(1),
  );

  if (existingByExternalId) {
    console.log(
      `[webhook/post-call] Duplicate: conversation=${conversationId} already stored as session=${existingByExternalId.id}`,
    );
    return c.json({ received: true, session_id: existingByExternalId.id });
  }

  // 7. Store session + messages + links in a transaction
  let sessionId: string;

  try {
    sessionId = await forOrg(agentRow.organizationId, async (tx) => {
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

        if (linkRows.length > 0) {
          await tx
            .insert(sessionLinks)
            .values(
              linkRows.map((l) => ({ ...l, sessionId: existingSessionId })),
            )
            .onConflictDoNothing({
              target: [sessionLinks.sessionId, sessionLinks.url],
            });
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

      if (linkRows.length > 0) {
        await tx
          .insert(sessionLinks)
          .values(linkRows.map((l) => ({ ...l, sessionId: session.id })))
          .onConflictDoNothing({
            target: [sessionLinks.sessionId, sessionLinks.url],
          });
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

// ============================================================================
// POST /:agentId/conversation-init — conversation initiation webhook (call start)
// ============================================================================

app.post("/:agentId/conversation-init", async (c) => {
  const agentId = c.req.param("agentId");
  const apiKeyHeader = c.req.header("x-mg-api-key");

  // 1. Authenticate via API key header
  if (!apiKeyHeader) {
    console.warn(
      `[webhook/conversation-init] Missing x-mg-api-key header for agent=${agentId}`,
    );
    return c.json({ error: "Missing x-mg-api-key header" }, 401);
  }

  const authAgent = await verifyApiKey(apiKeyHeader);
  if (!authAgent) {
    console.warn(
      `[webhook/conversation-init] Invalid API key for agent=${agentId}`,
    );
    return c.json({ error: "Invalid API key" }, 401);
  }

  // 2. Verify the API key belongs to the requested agent
  if (authAgent.id !== agentId) {
    console.warn(
      `[webhook/conversation-init] API key agent mismatch: key=${authAgent.id} url=${agentId}`,
    );
    return c.json({ error: "API key does not match agent" }, 403);
  }

  // 3. Parse request body
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = conversationInitRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    console.error(
      "[webhook/conversation-init] Validation failed:",
      JSON.stringify(parsed.error.flatten()),
    );
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const { caller_id, called_number, call_sid } = parsed.data;

  // 4. Idempotency: if call_sid is present, check for existing active session
  if (call_sid) {
    const [existing] = await forOrg(authAgent.organizationId, (tx) =>
      tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.agentId, agentId),
            eq(sessions.status, "active"),
            sql`${sessions.metadata}->>'call_sid' = ${call_sid}`,
          ),
        )
        .limit(1),
    );

    if (existing) {
      console.log(
        `[webhook/conversation-init] Idempotent hit: call_sid=${call_sid} session=${existing.id}`,
      );
      return c.json({
        type: "conversation_initiation_client_data" as const,
        dynamic_variables: { mg_session_id: existing.id },
      });
    }
  }

  // 5. Create new session
  let sessionId: string;
  try {
    sessionId = await forOrg(authAgent.organizationId, async (tx) => {
      const [session] = await tx
        .insert(sessions)
        .values({
          organizationId: authAgent.organizationId,
          agentId,
          channelType: "voice",
          status: "active",
          userIdentifier: caller_id ?? null,
          metadata: {
            ...(caller_id ? { caller_id } : {}),
            ...(called_number ? { called_number } : {}),
            ...(call_sid ? { call_sid } : {}),
          },
        })
        .returning({ id: sessions.id });
      return session.id;
    });
  } catch (err) {
    console.error(
      `[webhook/conversation-init] DB error creating session for agent=${agentId}`,
      err,
    );
    return c.json({ error: "Failed to create session" }, 500);
  }

  console.log(
    `[webhook/conversation-init] Created session=${sessionId} agent=${agentId}${caller_id ? ` caller=${caller_id}` : ""}${call_sid ? ` call_sid=${call_sid}` : ""}`,
  );

  return c.json({
    type: "conversation_initiation_client_data" as const,
    dynamic_variables: { mg_session_id: sessionId },
  });
});

export default app;
