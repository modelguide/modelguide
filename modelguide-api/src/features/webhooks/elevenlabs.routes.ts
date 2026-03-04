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
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppBindings } from "@/types";
import { getAgentSecretByType } from "@features/secrets";
import { extractLinks } from "@features/sessions/link-extraction";
import { mask } from "@lib/crypto";
import { getLogger } from "@lib/logger";
import { verifyApiKey } from "@lib/middleware/auth";
import { convertPostCallToSession } from "./elevenlabs.converter";
import {
  conversationInitRequestSchema,
  postCallTranscriptionPayloadSchema,
} from "./elevenlabs.schemas";

const app = new Hono<AppBindings>();

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
  const reqLog = getLogger().child({
    webhook: "post-call",
    agentId,
  });
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
    reqLog.error("no webhook_secret in secrets table");
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
      reqLog.error({ err }, "signature verification failed");
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  // 3. Parse & validate payload
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    reqLog.error("invalid JSON body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parsed = postCallTranscriptionPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    reqLog.error(
      { validation: parsed.error.flatten() },
      "payload validation failed",
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
    reqLog.error("no conversation_id in payload or dynamic_variables");
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
    reqLog.info(
      { conversationId, sessionId: existingByExternalId.id },
      "duplicate webhook — session already exists",
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
    reqLog.error({ err, conversationId }, "DB error storing session");
    return c.json({ error: "Failed to store session" }, 500);
  }

  reqLog.info(
    {
      action: existingSessionId ? "updated" : "created",
      sessionId,
      conversationId,
      messages: converted.messages.length,
    },
    "post-call processed",
  );

  return c.json({ received: true, session_id: sessionId });
});

// ============================================================================
// POST /:agentId/conversation-init — conversation initiation webhook (call start)
// ============================================================================

app.post("/:agentId/conversation-init", async (c) => {
  const agentId = c.req.param("agentId");
  const reqLog = getLogger().child({
    webhook: "conversation-init",
    agentId,
  });
  const apiKeyHeader = c.req.header("x-mg-api-key");

  // 1. Authenticate via API key header
  if (!apiKeyHeader) {
    reqLog.warn("missing x-mg-api-key header");
    return c.json({ error: "Missing x-mg-api-key header" }, 401);
  }

  const authAgent = await verifyApiKey(apiKeyHeader);
  if (!authAgent || authAgent.id !== agentId) {
    reqLog.warn("auth failed");
    return c.json({ error: "Invalid API key" }, 401);
  }

  // 2. Parse request body
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = conversationInitRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    reqLog.error(
      { validation: parsed.error.flatten() },
      "payload validation failed",
    );
    return c.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      400,
    );
  }

  const { conversation_id, caller_id, called_number, call_sid } = parsed.data;

  // 3. Idempotency check + session creation in a single transaction to prevent
  //    duplicate sessions when ElevenLabs retries with the same conversation_id.
  let sessionId: string;
  try {
    sessionId = await forOrg(authAgent.organizationId, async (tx) => {
      if (conversation_id) {
        const [existing] = await tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.agentId, agentId),
              eq(sessions.externalId, conversation_id),
            ),
          )
          .limit(1);

        if (existing) return existing.id;
      }

      const [session] = await tx
        .insert(sessions)
        .values({
          organizationId: authAgent.organizationId,
          agentId,
          channelType: "voice",
          status: "active",
          externalId: conversation_id ?? null,
          userIdentifier: caller_id ?? null,
          metadata: {
            ...(called_number ? { called_number } : {}),
            ...(call_sid ? { call_sid } : {}),
          },
        })
        .returning({ id: sessions.id });
      return session.id;
    });
  } catch (err) {
    reqLog.error({ err }, "DB error creating session");
    return c.json({ error: "Failed to create session" }, 500);
  }

  const maskedCallerId = caller_id ? mask(caller_id) : undefined;
  reqLog.info(
    {
      sessionId,
      conversationId: conversation_id,
      caller: maskedCallerId,
    },
    "conversation initiated",
  );

  return c.json({
    type: "conversation_initiation_client_data" as const,
    dynamic_variables: { mg_session_id: sessionId },
  });
});

export default app;
