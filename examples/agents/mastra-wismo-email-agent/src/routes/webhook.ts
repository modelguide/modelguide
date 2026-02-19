import { RequestContext } from "@mastra/core/request-context";
import { MCPClient } from "@mastra/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { apiBaseUrl, config } from "../config.js";
import { extractEmailAddress, sendEmail, stripQuotedReply } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import type { Step } from "../lib/modelguide.js";
import {
  logAgentTurns,
  patchSessionStatus,
  postStepMessages,
  postUserMessage,
} from "../lib/modelguide.js";
import { wismoAgent, wismoRequestContextSchema } from "../mastra/agents/wismo.js";

function tryParseJson(text: string): unknown {
  // Find the last complete {...} block — the final JSON output from the agent
  let lastMatch: string | null = null;
  const re = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastMatch = m[0];
  }
  if (!lastMatch) return null;
  try {
    return JSON.parse(lastMatch);
  } catch {
    return null;
  }
}

// Resend email.received webhook — body is NOT included, must be fetched separately
const resendWebhookPayloadSchema = z.object({
  type: z.literal("email.received"),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    created_at: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string(),
    // message_id may be absent in the webhook; fetched email has it
    message_id: z.string().optional(),
  }),
});

// Structured output schema — agent's final JSON-only message
const agentOutputSchema = z.object({
  ticketId: z.number().int().optional(),
  replyBody: z.string(),
  escalated: z.boolean().default(false),
});

/**
 * Pre-create a ModelGuide session before running the agent.
 * MCP tools call validateActiveSession() on every invocation, so a real DB session
 * must exist before any MCP tool call can succeed.
 */
async function createSession(params: {
  senderEmail: string;
  externalId: string;
}): Promise<string> {
  const res = await fetch(`${apiBaseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.MCP_API_KEY}`,
    },
    body: JSON.stringify({
      channelType: "email",
      userIdentifier: params.senderEmail,
      externalId: params.externalId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  logger.info({ sessionId: data.id, senderEmail: params.senderEmail }, "Session created");
  return data.id;
}

export const webhookRouter = new Hono();

webhookRouter.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const parseResult = resendWebhookPayloadSchema.safeParse(body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, "Invalid webhook payload");
    return c.json({ error: "Invalid payload" }, 400);
  }

  const { email_id, to: webhookTo } = parseResult.data.data;

  // Early inbox filter — use the to field from the webhook payload so we can skip
  // before making any downstream API calls (Resend fetch, ModelGuide, MCP).
  const inboxEmail = config.INBOX_EMAIL.toLowerCase();
  const recipientMatch = webhookTo.some((addr) => {
    const { email } = extractEmailAddress(addr);
    return email.toLowerCase() === inboxEmail;
  });

  if (!recipientMatch) {
    logger.info({ email_id, to: webhookTo, inboxEmail }, "Email not addressed to inbox — skipping");
    return c.json({ skipped: true });
  }

  logger.info({ email_id }, "Fetching full email content");

  // Webhook payload does not include body — must fetch separately via Resend REST API
  const emailRes = await fetch(`https://api.resend.com/emails/receiving/${email_id}`, {
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` },
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    logger.error({ status: emailRes.status, body: errText, email_id }, "Failed to fetch email content");
    return c.json({ error: "Failed to fetch email content" }, 500);
  }

  const fullEmail = await emailRes.json() as {
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    text?: string;
    html?: string;
    // headers may be an array [{name, value}] or a plain object {name: value}
    headers?: { name: string; value: string }[] | Record<string, string>;
  };

  logger.debug({ fullEmail }, "Full email content fetched");

  // All email metadata comes from the fetched payload, not the webhook
  const from = fullEmail.from ?? parseResult.data.data.from;
  const to = fullEmail.to ?? parseResult.data.data.to;
  const subject = fullEmail.subject ?? parseResult.data.data.subject;
  const receivedAt = fullEmail.created_at ?? parseResult.data.data.created_at;

  const { email: senderEmail } = extractEmailAddress(from);

  logger.info(
    {
      email_id,
      from,
      to,
      subject,
      hasText: !!fullEmail.text,
      hasHtml: !!fullEmail.html,
      headersType: Array.isArray(fullEmail.headers) ? "array" : typeof fullEmail.headers,
      headersCount: Array.isArray(fullEmail.headers)
        ? fullEmail.headers.length
        : fullEmail.headers
          ? Object.keys(fullEmail.headers).length
          : 0,
    },
    "Fetched email content",
  );

  const rawText = fullEmail.text ?? (fullEmail.html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  logger.debug({ rawText }, "Raw email text before stripping");
  const emailBody = stripQuotedReply(rawText);
  logger.debug({ emailBody }, "Email body after stripping quoted reply");

  // Normalize headers to a plain object regardless of API shape
  const headerMap: Record<string, string> = {};
  if (Array.isArray(fullEmail.headers)) {
    for (const h of fullEmail.headers) {
      headerMap[h.name.toLowerCase()] = h.value;
    }
  } else if (fullEmail.headers && typeof fullEmail.headers === "object") {
    for (const [k, v] of Object.entries(fullEmail.headers)) {
      headerMap[k.toLowerCase()] = v;
    }
  }

  const message_id = headerMap["message-id"] ?? email_id;
  const in_reply_to = headerMap["in-reply-to"] ?? null;

  logger.info({ email_id, senderEmail, subject, bodyLength: emailBody.length }, "Processing inbound email");

  // Pre-create a ModelGuide session. MCP tools require a valid, active session_id
  // in the DB before they will execute — createSession also derives agentId from the
  // mgk_... API key on the server side, so no explicit agentId needed in the body.
  let sessionId: string;
  try {
    sessionId = await createSession({ senderEmail, externalId: email_id });
  } catch (err) {
    logger.error({ err }, "Failed to pre-create ModelGuide session");
    return c.json({ error: "Failed to initialize session" }, 500);
  }

  // Store the inbound email immediately — persisted even if the agent crashes
  await postUserMessage(sessionId, { from, to, subject, body: emailBody, receivedAt });

  // Per-request MCPClient — isolated connection per email
  const mcpClient = new MCPClient({
    servers: {
      modelguide: {
        url: new URL(config.MCP_SERVER_URL),
        requestInit: {
          headers: { Authorization: `Bearer ${config.MCP_API_KEY}` },
        },
        timeout: 30_000,       // per-request MCP tool call timeout
        connectTimeout: 15_000, // protocol handshake timeout (default 3s too short for cold starts)
      },
    },
  });

  let agentOutput: z.infer<typeof agentOutputSchema>;
  let steps: Step[];
  let stepLatenciesMs: number[] = [];

  try {
    const toolsets = await mcpClient.listToolsets();
    logger.debug({ tools: Object.keys(toolsets) }, "MCP toolsets loaded");

    // Pass session_id and sender email via RequestContext — keeps them out of the
    // user prompt and makes them available to agent instructions and tools cleanly.
    const requestContext = new RequestContext<z.infer<typeof wismoRequestContextSchema>>();
    requestContext.set("sessionId", sessionId);
    requestContext.set("senderEmail", senderEmail);

    logger.debug({ sessionId, senderEmail, subject }, "Agent prompt");

    let stepStartMs = Date.now();

    // Collect per-step posting promises — we fire them off in onStepFinish and
    // await all of them after generate() completes, so the agent doesn't block
    // waiting for HTTP round-trips between steps.
    const stepPostPromises: Promise<void>[] = [];

    const result = await wismoAgent.generate(emailBody, {
      toolsets,
      requestContext,
      maxSteps: 5,
      onStepFinish: (step) => {
        const now = Date.now();
        const latencyMs = now - stepStartMs;
        stepLatenciesMs.push(latencyMs);
        stepStartMs = now;
        const stepIndex = stepLatenciesMs.length - 1;
        logger.debug({ stepIndex, latencyMs }, "Step finished");

        // Post this step's messages immediately (non-blocking)
        // occurredAt is derived from step.response.timestamp inside postStepMessages
        stepPostPromises.push(
          postStepMessages(sessionId, step as Step, latencyMs).catch((err) =>
            logger.error({ err, stepIndex, sessionId }, "Failed to post step messages"),
          ),
        );
      },
    });

    // Wait for all in-flight step posts before proceeding
    await Promise.all(stepPostPromises);

    steps = result.steps as Step[];
    logger.debug({ stepsCount: steps.length, stepLatenciesMs }, "Agent steps collected");

    // The model reliably places the final JSON in the last step's text.
    // structuredOutput + jsonPromptInjection fails to extract it when the model
    // embeds JSON inside a reasoning step rather than a standalone message.
    const lastStepText = [...steps].reverse().find((s) => s.text)?.text ?? "";
    const parsed = agentOutputSchema.safeParse(tryParseJson(lastStepText));
    if (parsed.success) {
      agentOutput = parsed.data;
    } else {
      logger.warn(
        { lastStepText, parseError: parsed.error.flatten() },
        "Agent output JSON parse failed — using fallback reply",
      );
      agentOutput = { replyBody: "We received your message and will follow up shortly.", escalated: false };
    }

    logAgentTurns(steps, stepLatenciesMs);
  } finally {
    await mcpClient.disconnect();
  }

  const { replyBody, escalated: isEscalated, ticketId } = agentOutput;

  if (ticketId) {
    logger.info({ ticketId, sessionId, escalated: isEscalated }, "Zendesk ticket created");
  }

  logger.info(
    { senderEmail, sessionId, steps: steps.length, escalated: isEscalated, ticketId, reply: replyBody },
    "Agent completed",
  );

  // Send reply via Resend (threaded via In-Reply-To)
  const emailParams = {
    to: senderEmail,
    subject: `Re: ${subject}`,
    text: replyBody,
    inReplyTo: in_reply_to ?? message_id,
  };
  logger.info({ emailParams }, "Sending reply email");

  const { id: resendId } = await sendEmail(emailParams);

  logger.info({ resendId, sessionId }, "Reply sent");

  const status = isEscalated ? "abandoned" : "completed";

  // PATCH final status (fire-and-forget — reply is already sent)
  patchSessionStatus(sessionId, status).catch((err) =>
    logger.error({ err, sessionId }, "Background session status patch failed"),
  );

  return c.json({ success: true, session_id: sessionId, resend_id: resendId, escalated: isEscalated, ticket_id: ticketId });
});
