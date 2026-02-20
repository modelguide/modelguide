import { convert } from "html-to-text";
import { Webhook } from "svix";
import { Hono } from "hono";
import { z } from "zod";
import { extractEmailAddress, sendEmail, stripQuotedReply } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { createSession, patchSessionStatus, postUserMessage } from "../lib/modelguide.js";
import { runWismoAgent } from "../mastra/agents/wismo.js";
import { config, isDev } from "../config.js";

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

export const webhookRouter = new Hono();

webhookRouter.post("/", async (c) => {
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: "Failed to read request body" }, 400);
  }

  if (!isDev) {
    const wh = new Webhook(config.RESEND_WEBHOOK_SECRET!);
    try {
      wh.verify(rawBody, {
        "svix-id": c.req.header("svix-id") ?? "",
        "svix-timestamp": c.req.header("svix-timestamp") ?? "",
        "svix-signature": c.req.header("svix-signature") ?? "",
      });
    } catch {
      return c.json({ error: "Invalid signature" }, 401);
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
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

  const rawText = fullEmail.text ?? convert(fullEmail.html ?? "", { wordwrap: false });
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
  // in the DB before they will execute.
  let sessionId: string;
  try {
    sessionId = await createSession({ senderEmail, externalId: email_id });
  } catch (err) {
    logger.error({ err }, "Failed to pre-create ModelGuide session");
    return c.json({ error: "Failed to initialize session" }, 500);
  }

  // Store the inbound email immediately — persisted even if the agent crashes
  await postUserMessage(sessionId, { from, to, subject, body: emailBody, receivedAt });

  // Run the agent
  const { output, steps } = await runWismoAgent({ sessionId, senderEmail, emailBody });
  const { replyBody, escalated: isEscalated, ticketId } = output;

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
